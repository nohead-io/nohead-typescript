import { describe, expect, it } from "vitest"

import { NoheadError, Page } from "../src/index.ts"
import { json, mockClient, page, raw, record } from "./helpers.ts"

describe("pagination", () => {
  it("awaits to the first page, then pages by hand", async () => {
    const { nohead, calls } = mockClient([
      page([record("rec_1")], "c2"),
      page([record("rec_2")], null),
    ])
    const first = await nohead.records.list("posts", { limit: 1 })
    expect(first).toBeInstanceOf(Page)
    expect(first.data.map((r) => r.id)).toEqual(["rec_1"])
    expect(first.meta).toEqual({ next_cursor: "c2", has_more: true })
    expect(first.hasNextPage()).toBe(true)
    expect(calls[0]!.url.searchParams.has("cursor")).toBe(false)
    const second = await first.getNextPage()
    expect(second.data[0]!.id).toBe("rec_2")
    expect(calls[1]!.url.searchParams.get("cursor")).toBe("c2")
    expect(second.hasNextPage()).toBe(false)
    await expect(second.getNextPage()).rejects.toBeInstanceOf(NoheadError)
  })

  it("keeps a read's rich_text on later pages", async () => {
    const { nohead, calls } = mockClient([
      page([record("rec_1")], "c2"),
      page([record("rec_2")], null),
    ])
    const ids = []
    for await (const each of nohead.records.list("posts", {
      rich_text: "html",
    }))
      ids.push(each.id)
    expect(ids).toEqual(["rec_1", "rec_2"])
    expect(calls.map((c) => c.url.searchParams.get("rich_text"))).toEqual([
      "html",
      "html",
    ])
  })

  it("iterates every item across pages, keeping the parameters", async () => {
    const { nohead, calls } = mockClient([
      page([record("rec_1"), record("rec_2")], "c2"),
      page([record("rec_3")], null),
    ])
    const ids: string[] = []
    for await (const r of nohead.records.list("posts", {
      filter: { published_at: { exists: false } },
    })) {
      ids.push(r.id)
    }
    expect(ids).toEqual(["rec_1", "rec_2", "rec_3"])
    expect(calls[1]!.url.searchParams.get("cursor")).toBe("c2")
    expect(calls[1]!.url.searchParams.get("filter[published_at][exists]")).toBe(
      "false"
    )
  })

  it("stops on has_more without a cursor", async () => {
    const { nohead, calls } = mockClient([
      page([record("rec_1")], null, true),
      page([record("rec_2")], null),
    ])
    const ids: string[] = []
    for await (const r of nohead.records.list("posts")) ids.push(r.id)
    expect(ids).toEqual(["rec_1"])
    expect(calls).toHaveLength(1)
  })

  it("stops on a cursor without has_more", async () => {
    const { nohead, calls } = mockClient([
      page([record("rec_1")], "c2", false),
      page([record("rec_2")], null),
    ])
    const ids: string[] = []
    for await (const r of nohead.records.list("posts")) ids.push(r.id)
    expect(ids).toEqual(["rec_1"])
    expect(calls).toHaveLength(1)
  })

  it("walks past an empty page", async () => {
    const { nohead, calls } = mockClient([
      page([record("rec_1")], "c2"),
      page([], "c3"),
      page([record("rec_3")], null),
    ])
    const ids: string[] = []
    for await (const r of nohead.records.list("posts")) ids.push(r.id)
    expect(ids).toEqual(["rec_1", "rec_3"])
    expect(calls.map((c) => c.url.searchParams.get("cursor"))).toEqual([
      null,
      "c2",
      "c3",
    ])
  })

  it("stops fetching once it has enough", async () => {
    const { nohead, calls } = mockClient([
      page([record("rec_1"), record("rec_2")], "c2"),
    ])
    const ids: string[] = []
    for await (const r of nohead.records.list("posts")) {
      ids.push(r.id)
      break
    }
    expect(ids).toEqual(["rec_1"])
    expect(calls).toHaveLength(1)
  })

  it("resumes from a cursor", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    await nohead.records.list("posts", { cursor: "saved" })
    expect(calls[0]!.url.searchParams.get("cursor")).toBe("saved")
  })

  it("keeps search totals", async () => {
    const { nohead, calls } = mockClient([
      json(200, {
        data: [record("rec_1")],
        meta: { next_cursor: null, has_more: false, total_estimate: 1 },
      }),
    ])
    const hits = await nohead.search("hello", {
      collections: ["posts", "pages"],
    })
    expect(hits.meta.total_estimate).toBe(1)
    expect(calls[0]!.url.pathname).toBe("/v1/projects/prj_1/search")
    expect(calls[0]!.url.searchParams.get("q")).toBe("hello")
    expect(calls[0]!.url.searchParams.get("filter[collection][in]")).toBe(
      "posts,pages"
    )
  })

  it.each([
    ["a string", json(200, "posts")],
    ["null", json(200, null)],
    ["an object without data", json(200, { meta: {} })],
    ["a page", new Response("<html>OK</html>", { status: 200 })],
  ])("can't read %s as a list", async (_, reply) => {
    const { nohead } = mockClient([raw(reply)])
    const error = await nohead.records.list("posts").catch((e: unknown) => e)
    expect(error).toEqual(
      new NoheadError("The API's response could not be read (HTTP 200)")
    )
    expect((error as Error).constructor).toBe(NoheadError)
  })
})
