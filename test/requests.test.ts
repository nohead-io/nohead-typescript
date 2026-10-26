import { describe, expect, expectTypeOf, it } from "vitest"

import { NoheadError } from "../src/index.ts"
import { exampleOf, json, mockClient, page, record } from "./helpers.ts"

describe("requests", () => {
  it("encodes path parameters", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    await nohead.records.list("my posts/1")
    expect(calls[0]!.url.pathname).toBe(
      "/v1/collections/my%20posts%2F1/records"
    )
  })

  it.each([".", ".."])("refuses %j as a path value", async (value) => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))])
    const error = await nohead.records.get(value).catch((e: unknown) => e)
    expect(error).toEqual(new NoheadError(`Invalid record_id: "${value}"`))
    expect(error).toBeInstanceOf(NoheadError)
    expect(calls).toHaveLength(0)
  })

  it("serializes filters, sorts and expansions as the API reads them", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    await nohead.records.list("posts", {
      filter: {
        published_at: { exists: true },
        featured: true,
        views: 3,
        published_after: new Date("2026-01-01T00:00:00Z"),
        skip: undefined,
      },
      sort: "-published_at",
      expand: ["author", "tags"],
      limit: 50,
    })
    const params = calls[0]!.url.searchParams
    expect(params.get("filter[published_at][exists]")).toBe("true")
    expect(params.get("filter[featured]")).toBe("true")
    expect(params.get("filter[views]")).toBe("3")
    expect(params.get("filter[published_after]")).toBe(
      "2026-01-01T00:00:00.000Z"
    )
    expect(params.has("filter[skip]")).toBe(false)
    expect(params.get("sort")).toBe("-published_at")
    expect(params.get("expand")).toBe("author,tags")
    expect(params.get("limit")).toBe("50")
  })

  it("sends filter operators, escaping commas in lists", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    await nohead.records.list("products", {
      filter: {
        brand: { ne: "acme" },
        price: { gte: 10, lt: 50 },
        category: { in: ["shoes", "hats, caps", "a\\b"] },
        cover: { exists: true },
        released: { gte: "today" },
      },
      sort: "-price",
    })
    const params = calls[0]!.url.searchParams
    expect(params.get("filter[brand][ne]")).toBe("acme")
    expect(params.get("filter[price][gte]")).toBe("10")
    expect(params.get("filter[price][lt]")).toBe("50")
    expect(params.get("filter[category][in]")).toBe("shoes,hats\\, caps,a\\\\b")
    expect(params.get("filter[cover][exists]")).toBe("true")
    expect(params.get("filter[released][gte]")).toBe("today")
    expect(params.get("sort")).toBe("-price")
  })

  it("leaves missing list items out, and a list of none", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    const missing = [undefined, null] as unknown as string[]
    await nohead.records.list("products", {
      filter: {
        category: { in: ["shoes", ...missing] },
        tag: { in: missing },
      },
    })
    const params = calls[0]!.url.searchParams
    expect(params.get("filter[category][in]")).toBe("shoes")
    expect(params.has("filter[tag][in]")).toBe(false)
  })

  it("sends bodies as JSON", async () => {
    const { nohead, calls } = mockClient([json(201, record("rec_1"))])
    await nohead.records.create("posts", { data: { title: "Hi" } })
    expect(calls[0]!.method).toBe("POST")
    expect(calls[0]!.headers.get("content-type")).toBe("application/json")
    expect(calls[0]!.body).toEqual({ data: { title: "Hi" } })
  })

  const schedule = json(200, exampleOf("records_schedule"))

  it("serializes dates in bodies as ISO 8601", async () => {
    const { nohead, calls } = mockClient([schedule])
    await nohead.records.schedule("rec_1", {
      publish_at: new Date("2027-01-01T09:00:00Z"),
    })
    expect(calls[0]!.body).toEqual({ publish_at: "2027-01-01T09:00:00.000Z" })
  })

  it.each([NaN, Infinity, -Infinity])(
    "refuses %s, which JSON can't carry",
    async (value) => {
      const { nohead, calls } = mockClient([json(201, record("rec_1"))])
      await expect(
        nohead.records.create("posts", { data: { price: value } })
      ).rejects.toThrow(new TypeError(`JSON can't carry ${value} (in price)`))
      expect(calls).toHaveLength(0)
    }
  )

  it("sends the schedule as given: a time left out is cleared", async () => {
    const { nohead, calls } = mockClient([schedule])
    await nohead.records.schedule("rec_1", { unpublish_at: null })
    await nohead.records.schedule("rec_1", {})
    expect(calls.map((c) => c.body)).toEqual([{ unpublish_at: null }, {}])
  })

  it("gives every write an idempotency key, and none to reads", async () => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))])
    await nohead.records.publish("rec_1")
    await nohead.records.publish("rec_1")
    await nohead.records.get("rec_1")
    const [first, second, read] = calls.map((c) =>
      c.headers.get("idempotency-key")
    )
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(second).not.toBe(first)
    expect(read).toBeNull()
  })

  it("generates an idempotency key for an empty one", async () => {
    const { nohead, calls } = mockClient([json(201, record("rec_1"))])
    await nohead.records.create("posts", { data: {} }, { idempotencyKey: "" })
    expect(calls[0]!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("uses the caller's idempotency key", async () => {
    const { nohead, calls } = mockClient([json(201, record("rec_1"))])
    await nohead.records.create(
      "posts",
      { data: {} },
      { idempotencyKey: "import-42" }
    )
    expect(calls[0]!.headers.get("idempotency-key")).toBe("import-42")
  })

  it("sends If-Match from a revision or a record", async () => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))])
    await nohead.records.update(
      "rec_1",
      { data: { title: null } },
      { ifMatch: 3 }
    )
    await nohead.records.publish("rec_1", { ifMatch: { revision: 4 } })
    expect(calls.map((c) => c.headers.get("if-match"))).toEqual(['"3"', '"4"'])
  })

  it.each([
    ["a string", "3"],
    ["a fraction", 3.5],
    ["NaN", NaN],
    ["an object without a revision", {}],
    ["a revision that isn't a number", { revision: "3" }],
  ])("refuses an ifMatch of %s", async (_, ifMatch) => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))])
    await expect(
      nohead.records.publish("rec_1", { ifMatch: ifMatch as number })
    ).rejects.toThrow(
      new TypeError(
        "ifMatch takes a revision number, or a record, draft or object with a revision"
      )
    )
    expect(calls).toHaveLength(0)
  })

  it("sends no change note for an empty one", async () => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))])
    await nohead.records.delete("rec_1", { changeNote: "" })
    expect(calls[0]!.headers.has("nohead-change-note")).toBe(false)
  })

  it("sends a change note in any language, percent-encoded", async () => {
    const { nohead, calls } = mockClient([
      json(200, record("rec_1")),
      json(200, record("rec_1")),
      json(200, record("rec_1")),
    ])
    await nohead.records.delete("rec_1", { changeNote: "Duplicate" })
    await nohead.records.delete("rec_1", { changeNote: "Rettet på forsiden ✓" })
    expect(calls[0]!.headers.get("nohead-change-note")).toBe("Duplicate")
    expect(calls[1]!.headers.get("nohead-change-note")).toBe(
      "Rettet%20p%C3%A5%20forsiden%20%E2%9C%93"
    )
    // Half an emoji (a string cut in the middle) is sent as U+FFFD.
    await nohead.records.delete("rec_1", { changeNote: "Cut \uD83D" })
    expect(calls[2]!.headers.get("nohead-change-note")).toBe("Cut%20%EF%BF%BD")
  })

  it("sends If-Match on a restore, and a draft's revision", async () => {
    const { nohead, calls } = mockClient([
      json(200, record("rec_1")),
      json(200, exampleOf("drafts_discard")),
    ])
    await nohead.records.restore("rec_1", { ifMatch: 2 })
    await nohead.drafts.discard("drf_1", { ifMatch: { revision: 5 } })
    expect(calls.map((c) => c.headers.get("if-match"))).toEqual(['"2"', '"5"'])
  })

  it("starts a draft from the record's values, typed like records", async () => {
    const draft = exampleOf("drafts_create", { data: { title: "Hi" } })
    const { nohead, calls } = mockClient([json(201, draft)])
    const created = await nohead.drafts.create<{ title: string }>("rec_1")
    expectTypeOf(created.data.title).toEqualTypeOf<string>()
    expect(created.data.title).toBe("Hi")
    expect(calls[0]!.body).toEqual({})
  })

  it("filters the activity log by several resource types and a time range", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    await nohead.auditEvents.list({
      filter: {
        type: "field.*",
        resource_type: ["collection", "field"],
        created_at: {
          gte: new Date("2026-10-01T00:00:00Z"),
          lt: "2026-11-01T00:00:00Z",
        },
      },
    })
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      "filter[type]": "field.*",
      "filter[resource_type][in]": "collection,field",
      "filter[created_at][gte]": "2026-10-01T00:00:00.000Z",
      "filter[created_at][lt]": "2026-11-01T00:00:00Z",
    })
  })

  it("sends dry runs as a query parameter", async () => {
    const { nohead, calls } = mockClient([
      json(200, exampleOf("migrations_create")),
    ])
    await nohead.migrations.create("posts", {
      field_id: "fld_1",
      type: "integer",
      dry_run: true,
    })
    expect(calls[0]!.url.pathname).toBe("/v1/collections/posts/migrations")
    expect(calls[0]!.url.searchParams.get("dry_run")).toBe("true")
    expect(calls[0]!.body).toEqual({ field_id: "fld_1", type: "integer" })
  })

  it("sends a diff's revisions as from and to", async () => {
    const { nohead, calls } = mockClient([
      json(200, exampleOf("records_diff", { from: 1, to: 2 })),
    ])
    const diff = await nohead.records.diff("rec_1", { from: 1, to: 2 })
    expect(diff.to).toBe(2)
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      from: "1",
      to: "2",
    })
  })
})
