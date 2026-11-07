import type { LoaderContext } from "astro/loaders"
import { z } from "astro/zod"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { noheadLoader, type NoheadLoaderOptions } from "../src/astro.ts"
import {
  API_HOST,
  apiError,
  exampleOf,
  mockFetch,
  page,
  record,
} from "./helpers.ts"

type Reply = Parameters<typeof mockFetch>[0][number]

interface Entry {
  id: string
  data: Record<string, unknown>
  digest?: string | number
  rendered?: { html: string }
}

const image = (id: string, fields: Record<string, unknown> = {}) =>
  exampleOf("assets_get", {
    id,
    filename: `${id}.jpg`,
    content_type: "image/jpeg",
    alt: "A chalkboard",
    width: 1200,
    height: 800,
    image_url: `https://images.nohead.io/plain/${id}`,
    file_url: `https://files.nohead.io/${id}.jpg`,
    media_url: null,
    ...fields,
  })

const published = (
  id: string,
  data: Record<string, unknown>,
  expanded?: Record<string, unknown>
) => ({
  ...record(id, data),
  published_at: "2026-10-02T12:00:00.000Z",
  ...(expanded ? { expanded } : {}),
})

/**
 * Astro's side of a load: a store kept in a Map, with parseData validating
 * against `schema` as a collection's schema does.
 */
function astro(schema: z.ZodType = z.record(z.string(), z.unknown())) {
  const entries = new Map<string, Entry>()
  const context = {
    collection: "posts",
    store: {
      keys: () => [...entries.keys()],
      get: (id: string) => entries.get(id),
      set: vi.fn((entry: Entry) => {
        entries.set(entry.id, entry)
        return true
      }),
      delete: vi.fn((id: string) => entries.delete(id)),
    },
    logger: { info: vi.fn() },
    parseData: vi.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(schema.parse(data))
    ),
    generateDigest: (data: unknown) => JSON.stringify(data),
    renderMarkdown: vi.fn((markdown: string) =>
      Promise.resolve({ html: `<p>${markdown}</p>`, metadata: {} })
    ),
  }
  return { context, entries }
}

function loader(replies: Reply[], options: Partial<NoheadLoaderOptions> = {}) {
  const { fetch, calls } = mockFetch(replies)
  const load = noheadLoader({
    collection: "posts",
    apiKey: "nohead_sk_test",
    baseUrl: `https://${API_HOST}`,
    fetch,
    ...options,
  })
  return {
    calls,
    load: (context: ReturnType<typeof astro>["context"]) =>
      load.load(context as unknown as LoaderContext),
  }
}

describe("noheadLoader", () => {
  it("stores every published record, page by page, as parsed by the schema", async () => {
    const { calls, load } = loader(
      [
        page([published("rec_1", { title: "One", date: "2026-10-01" })], "c2"),
        page([published("rec_2", { title: "Two", date: "2026-10-02" })], null),
      ],
      { expand: ["cover"] }
    )
    const { context, entries } = astro(
      z.object({ title: z.string(), date: z.coerce.date() })
    )
    await load(context)

    expect(context.parseData).toHaveBeenCalledWith({
      id: "rec_1",
      data: { title: "One", date: "2026-10-01" },
    })
    expect(entries.get("rec_2")).toEqual({
      id: "rec_2",
      data: { title: "Two", date: new Date("2026-10-02") },
      digest: JSON.stringify({ title: "Two", date: "2026-10-02" }),
      rendered: undefined,
    })
    expect(context.store.set).toHaveBeenCalledTimes(2)
    expect(context.logger.info).toHaveBeenCalledWith(
      "Loaded 2 records from posts"
    )

    const [first, second] = calls.map((call) => call.url.searchParams)
    expect(calls[0]!.url.pathname).toBe("/v1/collections/posts/records")
    expect(first!.get("filter[published_at][exists]")).toBe("true")
    expect(first!.get("limit")).toBe("100")
    expect(first!.has("sort")).toBe(false)
    expect(first!.get("expand")).toBe("cover")
    expect(first!.get("rich_text")).toBe("html")
    expect(second!.get("cursor")).toBe("c2")
  })

  it("adds filters to the published one, which a filter can change", async () => {
    const { calls, load } = loader([page([], null)], {
      filter: { featured: true },
    })
    await load(astro().context)
    expect(calls[0]!.url.searchParams.get("filter[featured]")).toBe("true")
    expect(calls[0]!.url.searchParams.get("filter[published_at][exists]")).toBe(
      "true"
    )

    const all = loader([page([], null)], {
      filter: { published_at: undefined },
    })
    await all.load(astro().context)
    expect(
      all.calls[0]!.url.searchParams.has("filter[published_at][exists]")
    ).toBe(false)
  })

  it("puts expanded assets and records in place of their IDs, and leaves empty values out", async () => {
    const { load } = loader([
      page(
        [
          published(
            "rec_1",
            {
              title: "One",
              summary: null,
              cover: "ast_1",
              gallery: ["ast_2", "ast_3"],
              photo: "ast_gone",
              category: "rec_9",
              editor: "rec_8",
              related: ["rec_5", "rec_6"],
              authors: ["rec_7"],
              body: '<p><img src="https://images.nohead.io/plain/ast_4"></p>',
            },
            {
              cover: image("ast_1", { alt: null }),
              gallery: [image("ast_2"), image("ast_3")],
              photo: null,
              category: published("rec_9", { name: "Studio", about: null }),
              // Unpublished, so left out as entries are.
              editor: record("rec_8", { name: "Draft" }),
              related: [published("rec_5", { title: "Five" }), record("rec_6")],
              body: [image("ast_4")],
            }
          ),
        ],
        null
      ),
    ])
    const { context, entries } = astro()
    await load(context)

    expect(entries.get("rec_1")!.data).toEqual({
      title: "One",
      cover: {
        id: "ast_1",
        filename: "ast_1.jpg",
        content_type: "image/jpeg",
        width: 1200,
        height: 800,
        image_url: "https://images.nohead.io/plain/ast_1",
        file_url: "https://files.nohead.io/ast_1.jpg",
      },
      gallery: [
        expect.objectContaining({ id: "ast_2", alt: "A chalkboard" }),
        expect.objectContaining({ id: "ast_3", width: 1200, height: 800 }),
      ],
      category: { id: "rec_9", data: { name: "Studio" } },
      related: [{ id: "rec_5", data: { title: "Five" } }],
      // Not expanded: an ID, for reference("people").
      authors: ["rec_7"],
      // A rich text field keeps its text, not the images it shows.
      body: '<p><img src="https://images.nohead.io/plain/ast_4"></p>',
    })
  })

  it("embeds unpublished records when the filter sets published_at", async () => {
    const { load } = loader(
      [
        page(
          [
            published(
              "rec_1",
              { editor: "rec_8" },
              { editor: record("rec_8", { name: "Draft" }) }
            ),
          ],
          null
        ),
      ],
      { filter: { published_at: undefined } }
    )
    const { context, entries } = astro()
    await load(context)
    expect(entries.get("rec_1")!.data).toEqual({
      editor: { id: "rec_8", data: { name: "Draft" } },
    })
  })

  it("leaves unpublished records out when the filter keeps entries published", async () => {
    const { load } = loader(
      [
        page(
          [
            published(
              "rec_1",
              { editor: "rec_8" },
              { editor: record("rec_8", { name: "Draft" }) }
            ),
          ],
          null
        ),
      ],
      { filter: { published_at: { gte: "2026-01-01" } } }
    )
    const { context, entries } = astro()
    await load(context)
    expect(entries.get("rec_1")!.data).toEqual({})
  })

  it("renders the body as HTML, moving it out of the data", async () => {
    const { load } = loader(
      [page([published("rec_1", { title: "One", body: "<p>Hi</p>" })], null)],
      { body: "body" }
    )
    const { context, entries } = astro()
    await load(context)
    expect(entries.get("rec_1")).toMatchObject({
      data: { title: "One" },
      rendered: { html: "<p>Hi</p>" },
    })
    expect(entries.get("rec_1")!.data).not.toHaveProperty("body")
    expect(context.renderMarkdown).not.toHaveBeenCalled()
  })

  it("renders a Markdown body through Astro's pipeline", async () => {
    const { calls, load } = loader(
      [page([published("rec_1", { body: "Hi *there*" })], null)],
      { body: "body", richText: "markdown" }
    )
    const { context, entries } = astro()
    await load(context)
    expect(calls[0]!.url.searchParams.get("rich_text")).toBe("markdown")
    expect(context.renderMarkdown).toHaveBeenCalledWith("Hi *there*")
    expect(entries.get("rec_1")!.rendered).toEqual({
      html: "<p>Hi *there*</p>",
      metadata: {},
    })
  })

  it("refuses a body it can't render", () => {
    expect(() =>
      noheadLoader({ collection: "posts", body: "body", richText: "document" })
    ).toThrow(/set richText to "html" or "markdown"/)
    expect(() => noheadLoader({ collection: "" })).toThrow(
      "noheadLoader needs a collection"
    )
  })

  it("says where an Astro site's key goes when there is none", async () => {
    vi.stubEnv("NOHEAD_API_KEY", "")
    onTestFinished(() => void vi.unstubAllEnvs())
    const { load } = loader([page([], null)], { apiKey: undefined })
    await expect(load(astro().context)).rejects.toThrow(
      "Missing API key: pass `apiKey: import.meta.env.NOHEAD_API_KEY` to noheadLoader, or set NOHEAD_API_KEY in the environment"
    )
  })

  it("calls the API at NOHEAD_API_URL when it is set, as the client does", async () => {
    vi.stubEnv("NOHEAD_API_URL", "http://localhost:3000")
    onTestFinished(() => void vi.unstubAllEnvs())
    const { calls, load } = loader([page([], null)], { baseUrl: undefined })
    await load(astro().context)
    expect(calls[0]!.url.origin).toBe("http://localhost:3000")
  })

  it("removes entries no longer listed and skips unchanged ones", async () => {
    const { context, entries } = astro()
    const first = loader([
      page(
        [
          published("rec_1", { title: "One" }),
          published("rec_2", { title: "Two" }),
        ],
        null
      ),
    ])
    await first.load(context)
    context.parseData.mockClear()
    context.store.set.mockClear()

    const second = loader([
      page([published("rec_2", { title: "Two, revised" })], null),
    ])
    await second.load(context)
    expect(context.store.delete).toHaveBeenCalledWith("rec_1")
    expect([...entries.keys()]).toEqual(["rec_2"])
    expect(context.store.set).toHaveBeenCalledTimes(1)

    context.store.set.mockClear()
    await loader([
      page([published("rec_2", { title: "Two, revised" })], null),
    ]).load(context)
    expect(context.store.set).not.toHaveBeenCalled()
  })

  it("leaves the entries as they were when a request fails", async () => {
    const { context, entries } = astro()
    await loader([page([published("rec_1", { title: "One" })], null)]).load(
      context
    )
    const failing = loader(
      [
        page([published("rec_2", {})], "c2"),
        apiError(401, "authentication_error"),
      ],
      { maxRetries: 0 }
    )
    await expect(failing.load(context)).rejects.toThrow()
    expect([...entries.keys()]).toEqual(["rec_1"])
    expect(context.store.delete).not.toHaveBeenCalled()
  })

  it("fails the load, changing nothing, when the schema rejects a record", async () => {
    const { context, entries } = astro(z.object({ title: z.string() }))
    await loader([page([published("rec_1", { title: "One" })], null)]).load(
      context
    )
    context.store.set.mockClear()
    const { load } = loader([
      page(
        [
          published("rec_2", { title: "Two" }),
          published("rec_3", { title: 3 }),
        ],
        null
      ),
    ])
    await expect(load(context)).rejects.toThrow(z.ZodError)
    expect([...entries.keys()]).toEqual(["rec_1"])
    expect(context.store.set).not.toHaveBeenCalled()
    expect(context.store.delete).not.toHaveBeenCalled()
  })
})
