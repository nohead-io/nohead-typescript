import { describe, expect, it } from "vitest"

import { NoheadError, Page } from "../src/index.ts"
import { json, mockClient, page, record } from "./helpers.ts"

describe("pagination", () => {
  it("awaits to the first page", async () => {
    const { nohead, calls } = mockClient([page([record("rec_1")], "c2")])
    const first = await nohead.records.list("posts", { limit: 1 })
    expect(first).toBeInstanceOf(Page)
    expect(first.data.map((r) => r.id)).toEqual(["rec_1"])
    expect(first.meta).toEqual({ next_cursor: "c2", has_more: true })
    expect(first.hasNextPage()).toBe(true)
    expect(calls[0]!.url.searchParams.has("cursor")).toBe(false)
  })

  it("iterates every item across pages, keeping the parameters", async () => {
    const { nohead, calls } = mockClient([
      page([record("rec_1"), record("rec_2")], "c2"),
      page([record("rec_3")], null),
    ])
    const ids: string[] = []
    for await (const r of nohead.records.list("posts", {
      filter: { status: "draft" },
    })) {
      ids.push(r.id)
    }
    expect(ids).toEqual(["rec_1", "rec_2", "rec_3"])
    expect(calls[1]!.url.searchParams.get("cursor")).toBe("c2")
    expect(calls[1]!.url.searchParams.get("filter[status]")).toBe("draft")
  })

  it("pages by hand", async () => {
    const { nohead } = mockClient([
      page([record("rec_1")], "c2"),
      page([record("rec_2")], null),
    ])
    const first = await nohead.records.list("posts")
    const second = await first.getNextPage()
    expect(second.data[0]!.id).toBe("rec_2")
    expect(second.hasNextPage()).toBe(false)
    await expect(second.getNextPage()).rejects.toBeInstanceOf(NoheadError)
  })

  it("resumes from a cursor", async () => {
    const { nohead, calls } = mockClient([page([], null)])
    await nohead.records.list("posts", { cursor: "saved" })
    expect(calls[0]!.url.searchParams.get("cursor")).toBe("saved")
  })

  it("iterates a page from its own items on", async () => {
    const { nohead } = mockClient([
      page([record("rec_1")], "c2"),
      page([record("rec_2")], null),
    ])
    const first = await nohead.records.list("posts")
    const ids: string[] = []
    for await (const r of first) ids.push(r.id)
    expect(ids).toEqual(["rec_1", "rec_2"])
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
    expect(calls[0]!.url.searchParams.get("collections")).toBe("posts,pages")
  })
})
