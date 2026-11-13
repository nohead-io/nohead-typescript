// Public search through the platform's fetch, against a local stand-in for
// the search engine's multi-search endpoint.
import { describe, expect, expectTypeOf, it } from "vitest"

import {
  SEARCH_URL,
  SearchError,
  searchPublic,
  snippet,
  type ExpandedAsset,
  type ExpandedRecord,
  type RelatedTextField,
  type SearchHit,
  type Segment,
  type TextField,
} from "../src/search.ts"
import { localServer, sendJson } from "./server.ts"

interface Post {
  title: string
  slug: string
  summary?: string
  date: number
}

const token = "eyJhbGciOiJIUzI1NiJ9.eyJzZWFyY2hSdWxlcyI6e319.c2lnbmF0dXJl"
const index = "idx_01j9zq3f8x5w2k7m4n6p0r1s2t"

const record = {
  id: "rec_01J9ZQ3F8X5W2K7M4N6P0R1S2T",
  published_at: 1790812800,
  created_at: 1790800000,
  updated_at: 1790812800,
  data: {
    title: "Red lentil soup",
    slug: "red-lentil-soup",
    summary: "A soup of red lentils, cumin and lemon.",
    date: 1790812800,
  },
}

/** The search engine's answer: one result with these hits. */
function results(hits: unknown[], extra: Record<string, unknown> = {}) {
  return {
    results: [
      {
        indexUid: index,
        hits,
        query: "lentil",
        processingTimeMs: 1,
        limit: 20,
        offset: 0,
        estimatedTotalHits: hits.length,
        ...extra,
      },
    ],
  }
}

async function engine(status: number, body: unknown) {
  return localServer((_request, response) => sendJson(response, status, body))
}

const parsed = (body: Buffer) => JSON.parse(body.toString()) as unknown

describe("searchPublic", () => {
  it("searches the index with the token, and returns its hits", async () => {
    const server = await engine(
      200,
      results([record], { estimatedTotalHits: 42 })
    )
    const result = await searchPublic<Post>({
      token,
      index,
      q: "lentil",
      limit: 10,
      offset: 20,
      filter: ["data.date > 0", ["data.slug = a", "data.slug = b"]],
      sort: ["data.date:desc"],
      baseUrl: `${server.url}/`,
    })

    const [request] = server.received
    expect(request?.method).toBe("POST")
    expect(request?.path).toBe("/multi-search")
    expect(request?.headers.authorization).toBe(`Bearer ${token}`)
    expect(request?.headers["content-type"]).toBe("application/json")
    expect(parsed(request!.body)).toEqual({
      queries: [
        {
          indexUid: index,
          q: "lentil",
          limit: 10,
          offset: 20,
          filter: ["data.date > 0", ["data.slug = a", "data.slug = b"]],
          sort: ["data.date:desc"],
        },
      ],
    })
    expect(result).toEqual({
      hits: [{ ...record, expanded: {}, highlights: {} }],
      total: 42,
      query: "lentil",
    })
  })

  it("sends an empty query for every record, in its sort", async () => {
    const server = await engine(200, results([record], { query: "" }))
    const result = await searchPublic<Post>({
      token,
      index,
      limit: 5,
      sort: ["data.date:desc"],
      baseUrl: server.url,
    })
    expect(parsed(server.received[0]!.body)).toEqual({
      queries: [{ indexUid: index, q: "", limit: 5, sort: ["data.date:desc"] }],
    })
    expect(result.query).toBe("")
    expect(result.hits[0]?.data.title).toBe("Red lentil soup")
  })

  it("searches search.nohead.io by default", () => {
    expect(SEARCH_URL).toBe("https://search.nohead.io")
  })

  it("marks the highlighted fields' matches as segments", async () => {
    const server = await engine(
      200,
      results([
        {
          ...record,
          data: { ...record.data, summary: undefined },
          _formatted: {
            data: {
              title: "Red \u0001lentil\u0002 soup",
              slug: "red-lentil-soup",
              date: "1790812800",
            },
          },
        },
        {
          ...record,
          _formatted: {
            data: {
              ...record.data,
              summary: "\u0001Lentils\u0002, \u0001lentil\u0002s",
            },
          },
        },
      ])
    )
    const { hits } = await searchPublic<Post>({
      token,
      index,
      q: "lentil",
      highlight: ["title", "summary"],
      baseUrl: server.url,
    })

    expect(parsed(server.received[0]!.body)).toMatchObject({
      queries: [
        {
          attributesToHighlight: ["data.title", "data.summary"],
          highlightPreTag: "\u0001",
          highlightPostTag: "\u0002",
        },
      ],
    })
    expect(hits[0]?.highlights).toEqual({
      title: [
        { text: "Red ", match: false },
        { text: "lentil", match: true },
        { text: " soup", match: false },
      ],
      // Left empty by the record.
      summary: [],
    })
    expect(hits[0]).not.toHaveProperty("_formatted")
    // Only text fields can be highlighted.
    expectTypeOf<TextField<Post>>().toEqualTypeOf<
      "title" | "slug" | "summary"
    >()
    expectTypeOf<TextField<{ [key: string]: unknown }>>().toBeString()
    expectTypeOf<SearchHit<Post>["highlights"]>().toEqualTypeOf<{
      title?: Segment[]
      slug?: Segment[]
      summary?: Segment[]
    }>()
    expect(hits[1]?.highlights.summary).toEqual([
      { text: "Lentils", match: true },
      { text: ", ", match: false },
      { text: "lentil", match: true },
      { text: "s", match: false },
    ])
    // A field with nothing marked is its whole text.
    expect(hits[1]?.highlights.title).toEqual([
      { text: "Red lentil soup", match: false },
    ])
  })

  it("reads highlighted fields from data when the engine formats none", async () => {
    const server = await engine(200, results([record]))
    const { hits } = await searchPublic<Post>({
      token,
      index,
      highlight: ["title"],
      baseUrl: server.url,
    })
    expect(hits[0]?.highlights).toEqual({
      title: [{ text: "Red lentil soup", match: false }],
    })
  })

  it("returns what the hit's asset and relation fields include", async () => {
    const expanded = {
      cover: {
        id: "ast_A",
        image_url: "https://images.nohead.io/plain/p/a",
        width: 2000,
        height: 1333,
      },
      authors: [{ id: "rec_P", data: { name: "Leela Menon" } }],
    }
    const server = await engine(200, results([{ ...record, expanded }]))
    const { hits } = await searchPublic<
      Post,
      { cover: ExpandedAsset; authors: ExpandedRecord<{ name: string }>[] }
    >({ token, index, baseUrl: server.url })

    expect(hits[0]?.expanded).toEqual(expanded)
    expectTypeOf(hits[0]!.expanded.cover).toEqualTypeOf<
      ExpandedAsset | undefined
    >()
    expectTypeOf(hits[0]!.expanded.authors![0]!.data.name).toEqualTypeOf<
      string | undefined
    >()
  })

  it("marks related records' highlighted fields on each record", async () => {
    type Person = { name: string; bio?: string; age: number }
    type Expanded = {
      cover: ExpandedAsset
      authors: ExpandedRecord<Person>[]
      editor: ExpandedRecord<Person> | null
    }
    const cover = {
      id: "ast_A",
      image_url: "https://images.nohead.io/plain/p/a",
    }
    const leela = { id: "rec_P", data: { name: "Leela Menon" } }
    const jens = { id: "rec_Q", data: { name: "Jens Mikkelsen" } }
    const server = await engine(
      200,
      results([
        {
          ...record,
          expanded: { cover, authors: [leela, jens], editor: jens },
          _formatted: {
            data: record.data,
            expanded: {
              cover,
              authors: [
                { ...leela, data: { name: "\u0001Leela\u0002 Menon" } },
                jens,
              ],
              editor: jens,
            },
          },
        },
        // Gone, or from an index built before expansions.
        { ...record, expanded: { authors: [], editor: null } },
        record,
        // Nothing formatted: the whole text.
        { ...record, expanded: { authors: [jens] } },
      ])
    )
    const { hits } = await searchPublic<Post, Expanded>({
      token,
      index,
      q: "leela",
      highlight: ["title", "authors.name", "authors.bio", "editor.name"],
      baseUrl: server.url,
    })

    expect(parsed(server.received[0]!.body)).toMatchObject({
      queries: [
        {
          // A related record's data is returned whole, so it's marked whole.
          attributesToHighlight: [
            "data.title",
            "expanded.authors.data",
            "expanded.editor.data",
          ],
        },
      ],
    })
    expect(hits[0]?.expanded).toEqual({
      cover,
      authors: [
        {
          ...leela,
          highlights: {
            name: [
              { text: "Leela", match: true },
              { text: " Menon", match: false },
            ],
            bio: [],
          },
        },
        {
          ...jens,
          highlights: {
            name: [{ text: "Jens Mikkelsen", match: false }],
            bio: [],
          },
        },
      ],
      editor: {
        ...jens,
        highlights: {
          name: [{ text: "Jens Mikkelsen", match: false }],
        },
      },
    })
    expect(hits[0]?.highlights).toEqual({
      title: [{ text: "Red lentil soup", match: false }],
    })
    expect(hits[1]?.expanded).toEqual({ authors: [], editor: null })
    expect(hits[2]?.expanded).toEqual({})
    expect(hits[3]?.expanded.authors?.[0]?.highlights).toEqual({
      name: [{ text: "Jens Mikkelsen", match: false }],
      bio: [],
    })
    // Only related records' text fields can be highlighted.
    expectTypeOf<RelatedTextField<Expanded>>().toEqualTypeOf<
      "authors.name" | "authors.bio" | "editor.name" | "editor.bio"
    >()
  })

  it("throws the search engine's errors", async () => {
    const server = await engine(400, {
      message: "Attribute `data.title` is not filterable.",
      code: "invalid_search_filter",
      type: "invalid_request",
      link: "https://docs.meilisearch.com/errors#invalid_search_filter",
    })
    const error = await searchPublic({
      token,
      index,
      filter: "data.title = x",
      baseUrl: server.url,
    }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(SearchError)
    expect(error).toMatchObject({
      name: "SearchError",
      status: 400,
      code: "invalid_search_filter",
      message: "400: Attribute `data.title` is not filterable.",
      engineMessage: "Attribute `data.title` is not filterable.",
    })
  })

  it("names a refused token as the search token", async () => {
    const server = await engine(403, {
      message: "The provided API key is invalid.",
      code: "invalid_api_key",
      type: "auth",
      link: "https://docs.meilisearch.com/errors#invalid_api_key",
    })
    await expect(
      searchPublic({ token, index, baseUrl: server.url })
    ).rejects.toMatchObject({
      name: "SearchError",
      status: 403,
      code: "invalid_api_key",
      message: "403: The search token is invalid or was deleted",
      engineMessage: "The provided API key is invalid.",
    })

    const missing = await engine(401, {
      message:
        "The Authorization header is missing. It must use the bearer authorization method.",
      code: "missing_authorization_header",
      type: "auth",
    })
    await expect(
      searchPublic({ token, index, baseUrl: missing.url })
    ).rejects.toMatchObject({
      status: 401,
      message: "401: The search token is invalid or was deleted",
    })
  })

  it("names an index the token can't reach", async () => {
    const server = await engine(403, {
      message: "Inside `.queries[0]`: The provided API key is invalid.",
      code: "invalid_api_key",
      type: "auth",
    })
    await expect(
      searchPublic({ token, index: "nope", baseUrl: server.url })
    ).rejects.toMatchObject({
      status: 403,
      code: "invalid_api_key",
      message:
        "403: The search token can't search this index: check the index name, and that its collection is in public search",
      engineMessage: "Inside `.queries[0]`: The provided API key is invalid.",
    })
  })

  it("throws for an answer that isn't the engine's", async () => {
    const failed = await engine(429, "Too Many Requests")
    await expect(
      searchPublic({ token, index, baseUrl: failed.url })
    ).rejects.toMatchObject({
      status: 429,
      code: undefined,
      engineMessage: undefined,
      message: "429: Search failed with status 429",
    })

    const empty = await engine(200, { results: [] })
    await expect(
      searchPublic({ token, index, baseUrl: empty.url })
    ).rejects.toThrow("Search returned no results")
  })

  it("stops when its signal aborts", async () => {
    const server = await localServer(() => {
      // Never answers.
    })
    const controller = new AbortController()
    const search = searchPublic({
      token,
      index,
      q: "lentil",
      signal: controller.signal,
      baseUrl: server.url,
    })
    controller.abort()
    await expect(search).rejects.toMatchObject({ name: "AbortError" })
  })

  it("needs a token and an index", async () => {
    await expect(searchPublic({ token: "", index })).rejects.toThrow(
      "A search token is required"
    )
    await expect(searchPublic({ token, index: "" })).rejects.toThrow(
      "An index is required"
    )
  })
})

describe("snippet", () => {
  const text = (...parts: (string | [string])[]): Segment[] =>
    parts.map((part) =>
      typeof part === "string"
        ? { text: part, match: false }
        : { text: part[0], match: true }
    )
  const plain = (segments: Segment[]) =>
    segments.map((s) => (s.match ? `[${s.text}]` : s.text)).join("")

  const long =
    "The kitchen opened in spring with a short menu of soups and breads, and by the summer the queue reached the corner. "

  it("leaves short text as it is", () => {
    const short = text("A soup of red ", ["lentil"], "s.")
    expect(snippet(short)).toBe(short)
  })

  it("starts up to `before` characters ahead of the first match, at a word break", () => {
    const segments = text(long, ["Lentil"], " soup came later, and stayed.")
    expect(plain(snippet(segments, { length: 60, before: 20 }))).toBe(
      "…the corner. [Lentil] soup came later, and stayed."
    )
  })

  it("ends at a word break within the length", () => {
    const segments = text("Red ", ["lentil"], " soup. ", long)
    expect(plain(snippet(segments, { length: 40 }))).toBe(
      "Red [lentil] soup. The kitchen opened in…"
    )
  })

  it("keeps the start of text without a match", () => {
    expect(plain(snippet(text(long), { length: 30 }))).toBe(
      "The kitchen opened in spring…"
    )
  })

  it("cuts inside segments and keeps their marks", () => {
    const segments = text(long, ["soups"], " and ", ["soup"], long)
    const cut = snippet(segments, { length: 50, before: 10 })
    expect(plain(cut)).toBe(
      "…corner. [soups] and [soup]The kitchen opened in spring…"
    )
    expect(cut.filter((s) => s.match).map((s) => s.text)).toEqual([
      "soups",
      "soup",
    ])
  })

  it("keeps the match after a long run without word breaks", () => {
    const url = `https://example.com/${"a".repeat(300)}`
    const cut = snippet(text(`See ${url} `, ["lentil"], " soup."), {
      length: 60,
    })
    expect(plain(cut)).toBe("…[lentil] soup.")
  })

  it("keeps the match when `before` is longer than the snippet", () => {
    const cut = snippet(text(long, long, ["lentil"], long), {
      length: 30,
      before: 100,
    })
    expect(cut.some((s) => s.match)).toBe(true)
    expect(plain(cut)).toBe("…the corner. [lentil]The kitchen…")
  })

  it("breaks words at newlines too", () => {
    const cut = snippet(
      text(`${"x".repeat(50)}\n`, ["Lentils"], `\n${"y".repeat(50)}`),
      { length: 40, before: 10 }
    )
    expect(plain(cut)).toBe("…[Lentils]…")
  })

  it("never cuts an emoji in half", () => {
    const emoji = "\u{1F963}".repeat(30)
    const cut = snippet(text(emoji, ["lentil"], emoji), {
      length: 20,
      before: 5,
    })
    const joined = cut.map((s) => s.text).join("")
    expect(joined).not.toMatch(/^…[\udc00-\udfff]/)
    expect(joined).not.toMatch(/[\ud800-\udbff]…$/)
    expect(cut.some((s) => s.match)).toBe(true)
  })
})
