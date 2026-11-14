/**
 * Public search with a search token (`@nohead/sdk/search`): published records
 * of the collections included in public search, straight from the search
 * engine, as fast as someone types. No dependencies and no API key, so it
 * suits browser code (https://docs.nohead.io/guides/public-search).
 *
 *   const { hits, total } = await searchPublic<Post>({
 *     token, index, q: "lentil", highlight: ["title", "summary"],
 *   })
 *   hits[0].highlights.title // [{ text: "Red ", match: false }, { text: "lentil", match: true }, …]
 *
 * It's the small default: the same token works with the official `meilisearch`
 * client and with InstantSearch (`@meilisearch/instant-meilisearch`), for
 * facets or a ready-made search UI.
 */

/** Where search tokens search. */
export const SEARCH_URL = "https://search.nohead.io"

export interface SearchOptions<D = Record<string, unknown>> {
  /** A search token: public, so it can go in a page's source. */
  token: string
  /** The collection's public search index name (its Search tab, or its search index's `index`). */
  index: string
  /** The words to search for. Empty (the default) finds every record, for "latest" lists with `sort`. */
  q?: string
  /** At most this many hits (the search engine's default is 20). */
  limit?: number
  /** Skip this many hits first. */
  offset?: number
  /**
   * Filterable fields under `data`, as the search engine writes filters:
   * `'data.cuisine = "french"'`, or an array whose items must all hold
   * (an inner array is any of): `["data.servings > 2", ["data.cuisine = french", "data.cuisine = italian"]]`.
   */
  filter?: string | (string | string[])[]
  /** Sortable fields, first first: `["data.date:desc"]`, `["published_at:desc"]`. */
  sort?: string[]
  /** Text fields to mark the matched words in, by field key: each hit's `highlights` has them. */
  highlight?: TextField<D>[]
  /** Cancels the search: the promise rejects with the signal's reason (an `AbortError`). */
  signal?: AbortSignal
  /** For this SDK's tests against a local search engine: searches go to `SEARCH_URL`. */
  baseUrl?: string
}

/** The keys of `D`'s text fields: the ones `highlight` can mark. */
export type TextField<D> = string extends keyof D
  ? string
  : {
      [K in keyof D]-?: NonNullable<D[K]> extends string ? K : never
    }[keyof D] &
      string

/** A piece of a highlighted field: matched words (`match: true`) or the text around them. */
export interface Segment {
  text: string
  match: boolean
}

/** A published record that matched. */
export interface SearchHit<D = Record<string, unknown>> {
  /** The record's ID (`rec_…`). */
  id: string
  /** Unix seconds. */
  published_at: number
  /** Unix seconds. */
  created_at: number
  /** Unix seconds. */
  updated_at: number
  /**
   * Field values by key: dates as Unix seconds, rich text as plain text,
   * JSON as a string, assets and relations as IDs. Empty fields are left out.
   */
  data: D
  /**
   * Each field named in `highlight`, as segments to render, a `<mark>` for
   * each match: `[]` for a field the record leaves empty, and the whole text
   * unmarked when nothing in it matched.
   */
  highlights: Partial<Record<TextField<D>, Segment[]>>
}

export interface SearchResult<D = Record<string, unknown>> {
  hits: SearchHit<D>[]
  /** How many records match: an estimate past the first thousand or so. */
  total: number
  /** The words searched for. */
  query: string
}

/**
 * The search engine answered with an error, or didn't answer with results.
 * Not a `NoheadError`, so this module stays free of the client's code.
 */
export class SearchError extends Error {
  override name = "SearchError"
  /** The HTTP status; `0` when the response wasn't the search engine's. */
  readonly status: number
  /** The search engine's error code, e.g. `invalid_api_key`, `invalid_search_filter`. */
  readonly code: string | undefined
  /** The search engine's own message, which speaks of API keys where a search token was sent. */
  readonly engineMessage: string | undefined

  constructor(
    status: number,
    message: string,
    code?: string,
    engineMessage?: string
  ) {
    super(message)
    this.status = status
    this.code = code
    this.engineMessage = engineMessage
  }
}

// The engine's errors for a token it refuses, which it calls an API key.
const TOKEN_ERRORS = new Set([
  "invalid_api_key",
  "missing_authorization_header",
])
// It refuses a good token for an index outside the token's reach (another
// project's, or a collection not in public search) as a query's error.
const QUERY_ERROR = /^Inside `\.queries\[\d+\]`:/

// The search engine wraps matches in these; they never occur in text.
const MARK = "\u0001"
const UNMARK = "\u0002"

interface RawHit {
  id: string
  published_at: number
  created_at: number
  updated_at: number
  data: Record<string, unknown>
  _formatted?: { data?: Record<string, unknown> }
}

interface RawResult {
  hits: RawHit[]
  query?: string
  estimatedTotalHits?: number
}

/** Searches one collection's published records with a search token. */
export async function searchPublic<D = Record<string, unknown>>(
  options: SearchOptions<D>
): Promise<SearchResult<D>> {
  const { token, index, q = "", signal } = options
  if (!token) throw new TypeError("A search token is required")
  if (!index) throw new TypeError("An index is required")
  const highlight = options.highlight ?? []
  let base = options.baseUrl ?? SEARCH_URL
  while (base.endsWith("/")) base = base.slice(0, -1)

  const response = await fetch(`${base}/multi-search`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      queries: [
        {
          indexUid: index,
          q,
          limit: options.limit,
          offset: options.offset,
          filter: options.filter,
          sort: options.sort,
          ...(highlight.length > 0 && {
            // Each field by its path: hits return the fields their collection
            // includes, each by its path, and the engine marks those it's asked
            // for by path (asking for `data` as a whole marks nothing).
            attributesToHighlight: highlight.map((field) => `data.${field}`),
            highlightPreTag: MARK,
            highlightPostTag: UNMARK,
          }),
        },
      ],
    }),
  })
  const body = await readJson(response)
  if (!response.ok) throw errorOf(response.status, body)
  const result = (body as { results?: RawResult[] } | undefined)?.results?.[0]
  if (!result || !Array.isArray(result.hits))
    throw new SearchError(response.status, "Search returned no results")

  return {
    hits: result.hits.map((hit) => hitOf<D>(hit, highlight)),
    total: result.estimatedTotalHits ?? result.hits.length,
    query: result.query ?? q,
  }
}

function hitOf<D>(raw: RawHit, highlight: string[]): SearchHit<D> {
  const { _formatted: formatted, ...hit } = raw
  const highlights: Record<string, Segment[]> = {}
  for (const field of highlight) {
    const marked = formatted?.data?.[field]
    const value = typeof marked === "string" ? marked : hit.data[field]
    highlights[field] = typeof value === "string" ? segments(value) : []
  }
  return { ...hit, data: hit.data as D, highlights }
}

/** Text with the engine's marks, as segments. */
function segments(text: string): Segment[] {
  const pieces: Segment[] = []
  const push = (piece: string, match: boolean) => {
    if (piece) pieces.push({ text: piece, match })
  }
  text.split(MARK).forEach((part, i) => {
    if (i === 0) return push(part, false)
    const end = part.indexOf(UNMARK)
    if (end < 0) return push(part, true)
    push(part.slice(0, end), true)
    push(part.slice(end + 1), false)
  })
  return pieces
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function errorOf(status: number, body: unknown): SearchError {
  const error = body as { message?: unknown; code?: unknown } | undefined
  const engineMessage =
    typeof error?.message === "string" && error.message
      ? error.message
      : undefined
  const code = typeof error?.code === "string" ? error.code : undefined
  let message = engineMessage ?? `Search failed with status ${status}`
  if (code && TOKEN_ERRORS.has(code))
    message = QUERY_ERROR.test(engineMessage ?? "")
      ? "The search token can't search this index: check the index name, and that its collection is in public search"
      : "The search token is invalid or was deleted"
  return new SearchError(status, `${status}: ${message}`, code, engineMessage)
}

export interface SnippetOptions {
  /** At most this many characters, plus the ellipses (default 160). */
  length?: number
  /** Characters of context before the first match, up to half the length (default 40). */
  before?: number
}

/**
 * A long highlighted field cut down to the part around its first match, at
 * word breaks, with `…` where text was cut: for a summary or body under a
 * title. Without a match, its start.
 *
 *   snippet(hit.highlights.body ?? [], { length: 120 })
 */
export function snippet(
  text: Segment[],
  { length = 160, before = 40 }: SnippetOptions = {}
): Segment[] {
  const whole = text.map((segment) => segment.text).join("")
  if (whole.length <= length) return text

  // Where the first match starts, in the whole text.
  let first = 0
  for (const segment of text) {
    if (segment.match) break
    first += segment.text.length
  }
  if (first >= whole.length) first = 0

  // Start up to `before` characters ahead of the match, at the first word
  // break there (mid-word if there is none), and end at the last word break
  // within `length` that keeps the match.
  let start = Math.max(0, first - Math.min(before, Math.floor(length / 2)))
  if (start > 0) {
    const space = whole.slice(start, first).search(/\s/)
    if (space >= 0) start += space + 1
    else if (isLowSurrogate(whole, start)) start -= 1
    while (start < first && /\s/.test(whole.charAt(start))) start += 1
  }
  let end = Math.min(whole.length, start + length)
  if (end < whole.length) {
    const tail = whole.slice(first + 1, end + 1)
    const space = Math.max(tail.lastIndexOf(" "), tail.lastIndexOf("\n"))
    if (space >= 0) end = first + 1 + space
    else if (isLowSurrogate(whole, end)) end -= 1
  }

  const cut = slice(text, start, end)
  if (start > 0) cut.unshift({ text: "…", match: false })
  if (end < whole.length) cut.push({ text: "…", match: false })
  return cut
}

// The second half of a character outside the BMP (an emoji): no cut there.
function isLowSurrogate(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  return code >= 0xdc00 && code <= 0xdfff
}

/** The segments between two offsets of their whole text. */
function slice(text: Segment[], start: number, end: number): Segment[] {
  const cut: Segment[] = []
  let at = 0
  for (const segment of text) {
    const from = Math.max(start, at)
    const to = Math.min(end, at + segment.text.length)
    if (from < to)
      cut.push({
        text: segment.text.slice(from - at, to - at),
        match: segment.match,
      })
    at += segment.text.length
  }
  return cut
}
