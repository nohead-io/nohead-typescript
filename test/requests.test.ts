import { describe, expect, it } from "vitest"

import { json, mockClient, page, record } from "./helpers.ts"

describe("requests", () => {
  it("encodes path parameters", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    await nohead.records.list("my posts/1")
    expect(calls[0]!.url.pathname).toBe(
      "/v1/collections/my%20posts%2F1/records"
    )
  })

  it("serializes filters, sorts and expansions as the API reads them", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    await nohead.records.list("posts", {
      filter: {
        status: "published",
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
    expect(params.get("filter[status]")).toBe("published")
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
        status: { ne: "draft" },
        price: { gte: 10, lt: 50 },
        category: { in: ["shoes", "hats, caps", "a\\b"] },
        cover: { exists: true },
        released: { gte: "today" },
      },
      sort: "-price",
    })
    const params = calls[0]!.url.searchParams
    expect(params.get("filter[status][ne]")).toBe("draft")
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

  it("serializes dates in bodies as ISO 8601", async () => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))])
    await nohead.records.schedule("rec_1", {
      publish_at: new Date("2027-01-01T09:00:00Z"),
    })
    expect(calls[0]!.body).toEqual({ publish_at: "2027-01-01T09:00:00.000Z" })
  })

  it("clears scheduled times with null", async () => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))])
    await nohead.records.schedule("rec_1", { unpublish_at: null })
    expect(calls[0]!.body).toEqual({ unpublish_at: null })
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

  it("sends a change note", async () => {
    const { nohead, calls } = mockClient([json(200, record("rec_1"))])
    await nohead.records.delete("rec_1", { changeNote: "Duplicate" })
    expect(calls[0]!.headers.get("nohead-change-note")).toBe("Duplicate")
  })

  it("sends dry runs as a query parameter", async () => {
    const { nohead, calls } = mockClient([json(200, {})])
    await nohead.fields.migrate("fld_1", { type: "integer", dry_run: true })
    expect(calls[0]!.url.searchParams.get("dry_run")).toBe("true")
    expect(calls[0]!.body).toEqual({ type: "integer" })
  })

  it("sends a diff's revisions as from and to", async () => {
    const { nohead, calls } = mockClient([
      json(200, { object: "record_diff", from: 1, to: 2, changes: [] }),
    ])
    const diff = await nohead.records.diff("rec_1", { from: 1, to: 2 })
    expect(diff.to).toBe(2)
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      from: "1",
      to: "2",
    })
  })
})
