import { describe, expect, it } from "vitest"

import { NoheadError, Page } from "../src/index.ts"
import { json, mockClient, page, record } from "./helpers.ts"

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

  it("lists assets by type: one, or several with [in]", async () => {
    const { nohead, calls } = mockClient([page([], null), page([], null)])
    await nohead.assets.list({ content_type: "image/*" })
    await nohead.assets.list({ content_type: ["image/*", "application/pdf"] })
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      "filter[content_type]": "image/*",
    })
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({
      "filter[content_type][in]": "image/*,application/pdf",
    })
  })

  it("searches assets, and lists them by kind: one, or several with [in]", async () => {
    const { nohead, calls } = mockClient([page([], null), page([], null)])
    await nohead.assets.list({ q: "hero jpg", kind: "image" })
    await nohead.assets.list({ kind: ["image", "video"] })
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      q: "hero jpg",
      "filter[kind]": "image",
    })
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({
      "filter[kind][in]": "image,video",
    })
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
})
