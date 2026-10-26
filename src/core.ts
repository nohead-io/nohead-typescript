import {
  APIPromise,
  Page,
  PagePromise,
  type APIResponse,
} from "./api-promise.ts"
import {
  AbortError,
  ConnectionError,
  NoheadError,
  TimeoutError,
  apiError,
  isObject,
  retryAfterSeconds,
  type APIError,
} from "./errors.ts"
import {
  OPERATIONS,
  type OperationId,
  type Operations,
} from "./generated/operations.gen.ts"
import type { ListMeta } from "./generated/types.gen.ts"
import { VERSION } from "./version.ts"

export const DEFAULT_BASE_URL = "https://api.nohead.io"

export interface ClientOptions {
  /**
   * A project API key (`nohead_sk_…`, or `nohead_pk_…` when published-only).
   * Defaults to `NOHEAD_API_KEY`.
   */
  apiKey?: string
  /** Defaults to `NOHEAD_API_URL`, else `https://api.nohead.io`. */
  baseUrl?: string
  /** The key's project. Looked up once with `GET /v1/me` when omitted. */
  projectId?: string
  /** Retries of failed requests (see README, "Retries"). Default 2. */
  maxRetries?: number
  /**
   * Milliseconds an attempt may go without progress (connecting, waiting for
   * the response, then between chunks of its body). Default 60 000.
   */
  timeout?: number
  /** A `fetch` implementation, for proxies, instrumentation or tests. */
  fetch?: typeof fetch
  /** Headers added to every request. */
  headers?: Record<string, string>
  /** Log deprecation and plan usage warnings (once each). Default true. */
  warnings?: boolean
  /** Called before each retry, for example to report it. */
  onRetry?: (retry: RetryEvent) => void
}

/** What `withOptions` changes in a client's copy. */
export type CopyOptions = Pick<
  ClientOptions,
  "timeout" | "maxRetries" | "headers" | "onRetry"
>

/** A retry about to happen (`onRetry`). */
export interface RetryEvent {
  /** 1 for the first retry of the request, 2 for the second… */
  attempt: number
  /** Seconds the client waits before it. */
  delay: number
  /** The URL being retried. */
  url: string
  /** The status that failed, or undefined when the connection did. */
  status?: number
  /** What failed: an `APIError` or a `ConnectionError` (none for storage). */
  error?: NoheadError
}

export interface RequestOptions {
  /** Sent as `Idempotency-Key` on writes. Generated when omitted. */
  idempotencyKey?: string
  signal?: AbortSignal
  /** Milliseconds without progress, overriding the client's `timeout`. */
  timeout?: number
  /** Retries, overriding the client's. */
  maxRetries?: number
  headers?: Record<string, string>
}

/** Options of writes that change records or the schema. */
export interface WriteOptions extends RequestOptions {
  /**
   * A reason for the change, kept with the revision, schema change or
   * migration it makes (`Nohead-Change-Note`).
   */
  changeNote?: string
}

/** Options of draft writes that accept `If-Match`. */
export interface ConditionalRequestOptions extends RequestOptions {
  /**
   * Only write if the record (or the draft) is still at this revision;
   * otherwise the API answers `412` (`PreconditionFailedError`). A record
   * or a draft works too.
   */
  ifMatch?: number | { revision: number }
}

/** Options of record writes, which accept `If-Match` and a change note. */
export interface ConditionalWriteOptions
  extends WriteOptions, ConditionalRequestOptions {}

/** The request headers an operation declares. */
type HeadersOf<Op extends OperationId> = Operations[Op]["data"] extends {
  headers?: infer H
}
  ? keyof NonNullable<H>
  : never

/**
 * The options an operation takes: `ifMatch` and `changeNote` only where it
 * declares `If-Match` and `Nohead-Change-Note`, so a method can't offer them
 * elsewhere.
 */
export type OptionsOf<Op extends OperationId> = RequestOptions &
  ("If-Match" extends HeadersOf<Op>
    ? Pick<ConditionalRequestOptions, "ifMatch">
    : { ifMatch?: never }) &
  ("Nohead-Change-Note" extends HeadersOf<Op>
    ? Pick<WriteOptions, "changeNote">
    : { changeNote?: never })

export interface RequestInput {
  path?: Record<string, string | number | undefined>
  query?: object
  body?: unknown
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_RETRY_AFTER_SECONDS = 60

// Once per process, not per client: an app that makes a client per request
// (as on Workers) would otherwise warn on every one.
const warnedDeprecations = new Set<string>()
let warnedUsage = false

export class Core {
  readonly #apiKey: string
  readonly #baseUrl: string
  readonly #fetch: typeof fetch
  readonly #headers: Record<string, string>
  readonly #maxRetries: number
  readonly #timeout: number
  readonly #warnings: boolean
  readonly #onRetry: ClientOptions["onRetry"]
  // The project lookup, shared with the client's copies (`withOptions`).
  readonly #project: { id?: Promise<string> }

  constructor(options: ClientOptions, project: { id?: Promise<string> } = {}) {
    const env = environment()
    // Empty options and environment variables count as unset.
    const apiKey = options.apiKey || env.NOHEAD_API_KEY
    if (!apiKey) {
      throw new NoheadError(
        "Missing API key: pass `apiKey` or set NOHEAD_API_KEY"
      )
    }
    this.#apiKey = apiKey
    this.#baseUrl = baseUrlOf(
      options.baseUrl || env.NOHEAD_API_URL || DEFAULT_BASE_URL
    )
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#headers = options.headers ?? {}
    this.#maxRetries = options.maxRetries ?? 2
    this.#timeout = options.timeout ?? 60_000
    this.#warnings = options.warnings ?? true
    this.#onRetry = options.onRetry
    this.#project = project
    if (options.projectId) project.id ??= Promise.resolve(options.projectId)
  }

  /** A copy with other settings, sharing the project lookup. */
  withOptions(options: CopyOptions): Core {
    return new Core(
      {
        apiKey: this.#apiKey,
        baseUrl: this.#baseUrl,
        fetch: this.#fetch,
        headers: { ...this.#headers, ...options.headers },
        maxRetries: options.maxRetries ?? this.#maxRetries,
        timeout: options.timeout ?? this.#timeout,
        warnings: this.#warnings,
        onRetry: options.onRetry ?? this.#onRetry,
      },
      this.#project
    )
  }

  /** The API key's project, from `GET /v1/me` the first time. */
  projectId(): Promise<string> {
    this.#project.id ??= this.request("me_get", {}).then(
      (me) => {
        if (!me.api_key) {
          throw new NoheadError("The credentials are not a project API key")
        }
        return me.api_key.project_id
      },
      (error: unknown) => {
        this.#project.id = undefined
        throw error
      }
    )
    return this.#project.id
  }

  request<Op extends OperationId>(
    operation: Op,
    input: RequestInput = {},
    options: OptionsOf<Op> = {}
  ): APIPromise<Operations[Op]["response"]> {
    return new APIPromise(
      this.#send(operation, input, options) as Promise<
        APIResponse<Operations[Op]["response"]>
      >
    )
  }

  /** A list operation as pages of `Item`. */
  paginate<Item, Meta extends ListMeta = ListMeta>(
    operation: OperationId,
    input: RequestInput,
    options: RequestOptions = {}
  ): PagePromise<Item, Meta> {
    const fetchPage = async (
      cursor: string | undefined
    ): Promise<APIResponse<Page<Item, Meta>>> => {
      const query = { ...input.query, ...(cursor ? { cursor } : {}) }
      const result = await this.#send(operation, { ...input, query }, options)
      const list = result.data as { data: Item[]; meta: Meta }
      // A proxy's page, say, rather than the API's list.
      if (
        !isObject(list) ||
        !Array.isArray(list.data) ||
        !isObject(list.meta)
      ) {
        throw new NoheadError(
          `The API's response could not be read (HTTP ${result.response.status})`
        )
      }
      const page = new Page<Item, Meta>(list.data, list.meta, (next) =>
        fetchPage(next).then((r) => r.data)
      )
      return { ...result, data: page }
    }
    const first = (input.query as { cursor?: string } | undefined)?.cursor
    return new PagePromise(fetchPage(first))
  }

  /**
   * `fetch` with this client's retries, for an upload's presigned URL. fetch
   * shows no upload progress, so each attempt may take as long as sending
   * `byteSize` at 64 KiB/s, if that is longer than the timeout.
   */
  async fetchWithRetries(
    url: string,
    init: RequestInit,
    options: RequestOptions & { retry: boolean; byteSize: number }
  ): Promise<Response> {
    const maxRetries = options.retry
      ? (options.maxRetries ?? this.#maxRetries)
      : 0
    const timeout = Math.max(
      options.timeout ?? this.#timeout,
      (options.byteSize / 65_536) * 1000
    )
    for (let attempt = 0; ; attempt++) {
      let failed: { status?: number; error?: NoheadError }
      try {
        const { response } = await this.#attempt(
          url,
          init,
          { ...options, timeout },
          false
        )
        if (!RETRYABLE_STATUSES.has(response.status) || attempt >= maxRetries) {
          return response
        }
        failed = { status: response.status }
      } catch (error) {
        if (!(error instanceof ConnectionError) || attempt >= maxRetries) {
          throw error
        }
        failed = { error }
      }
      await this.#retry(url, attempt, backoff(attempt), failed, options.signal)
    }
  }

  async #send(
    operation: OperationId,
    input: RequestInput,
    options: ConditionalWriteOptions
  ): Promise<APIResponse<unknown>> {
    const { method, path } = OPERATIONS[operation]
    const url = new URL(this.#baseUrl + (await this.#path(path, input.path)))
    appendQuery(url.searchParams, input.query)

    // Each name once, whatever its case: the defaults, then the client's
    // headers, the call's, and those of the request options, which win.
    const headers: Record<string, string> = {}
    setHeaders(headers, {
      Accept: "application/json",
      Authorization: `Bearer ${this.#apiKey}`,
      "Nohead-Client": `sdk-typescript/${VERSION}`,
      ...USER_AGENT,
    })
    setHeaders(headers, this.#headers)
    setHeaders(headers, options.headers)
    const own: Record<string, string> = {}
    if (input.body !== undefined) own["Content-Type"] = "application/json"
    if (method !== "GET") {
      own["Idempotency-Key"] = options.idempotencyKey || crypto.randomUUID()
    }
    if (options.ifMatch !== undefined && options.ifMatch !== null) {
      own["If-Match"] = `"${revisionOf(options.ifMatch)}"`
    }
    // Percent-encoded UTF-8: header values are bytes, and fetch refuses
    // anything past Latin-1 (the API decodes it). Lone surrogates (half an
    // emoji, from cutting a string) become U+FFFD, so encodeURIComponent
    // can encode them.
    if (options.changeNote)
      own["Nohead-Change-Note"] = encodeURIComponent(
        options.changeNote.toWellFormed()
      )
    setHeaders(headers, own)

    const init: RequestInit = {
      method,
      headers,
      body:
        input.body === undefined
          ? undefined
          : JSON.stringify(input.body, finiteNumbers),
    }
    const maxRetries = options.maxRetries ?? this.#maxRetries

    for (let attempt = 0; ; attempt++) {
      let result: { response: Response; body: unknown }
      try {
        result = await this.#attempt(url.toString(), init, options, true)
      } catch (error) {
        if (!(error instanceof ConnectionError) || attempt >= maxRetries) {
          throw error
        }
        await this.#retry(
          url.toString(),
          attempt,
          backoff(attempt),
          { error },
          options.signal
        )
        continue
      }

      const { response, body } = result
      this.#warn(operation, response)
      const requestId = response.headers.get("x-request-id") ?? undefined
      if (response.ok) return { data: body, response, requestId }

      const error = apiError(response.status, body, response.headers)
      const delay = retryDelay(error, attempt, maxRetries)
      if (delay === undefined) throw error
      await this.#retry(
        url.toString(),
        attempt,
        delay,
        { status: response.status, error },
        options.signal
      )
    }
  }

  #retry(
    url: string,
    attempt: number,
    delay: number,
    failed: { status?: number; error?: NoheadError },
    signal: AbortSignal | undefined
  ): Promise<void> {
    this.#onRetry?.({ attempt: attempt + 1, delay, url, ...failed })
    return sleep(delay, signal)
  }

  async #attempt(
    url: string,
    init: RequestInit,
    options: RequestOptions,
    readBody: boolean
  ): Promise<{ response: Response; body: unknown }> {
    // The timeout is the longest wait for progress, so a response that
    // keeps arriving never times out: the timer starts again when the
    // response comes, and with each chunk of its body.
    const timeout = options.timeout ?? this.#timeout
    const timer = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const progress = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => timer.abort(), timeout)
    }
    const signal = options.signal
      ? AbortSignal.any([options.signal, timer.signal])
      : timer.signal
    try {
      progress()
      // Redirects aren't followed: one would send the API key to another
      // host, or a write as a GET.
      const response = await this.#fetch(url, {
        ...init,
        redirect: "manual",
        signal,
      })
      progress()
      const body = readBody
        ? await parseBody(response, signal, progress)
        : undefined
      return { response, body }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new AbortError("The request was aborted", {
          cause: options.signal.reason,
        })
      }
      if (timer.signal.aborted) {
        throw new TimeoutError(`The request timed out after ${timeout} ms`)
      }
      throw new ConnectionError(
        `Could not reach ${new URL(url).host}: ${(error as Error).message}`,
        { cause: error }
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async #path(
    template: string,
    values: RequestInput["path"] = {}
  ): Promise<string> {
    let path = template
    const names = [...template.matchAll(/\{(\w+)\}/g)].map(([, name]) => name!)
    // A value the template doesn't take is a method out of step with its operation.
    for (const name of Object.keys(values))
      if (!names.includes(name))
        throw new TypeError(`${name} is not a path parameter of ${template}`)
    for (const name of names) {
      let value = values[name]
      if (value === undefined && name === "project_id") {
        value = await this.projectId()
      }
      if (value === undefined || value === "") {
        throw new NoheadError(`Missing ${name}`)
      }
      // Encoding leaves these as they are, and URLs resolve them.
      if (value === "." || value === "..") {
        throw new NoheadError(`Invalid ${name}: "${value}"`)
      }
      path = path.replace(`{${name}}`, encodeURIComponent(String(value)))
    }
    return path
  }

  #warn(operation: OperationId, response: Response) {
    if (!this.#warnings) return
    const deprecation = response.headers.get("deprecation")
    if (deprecation && !warnedDeprecations.has(operation)) {
      warnedDeprecations.add(operation)
      const sunset = response.headers.get("sunset")
      const link = response.headers.get("link")?.match(/<([^>]+)>/)?.[1]
      console.warn(
        `[nohead] ${operation} is deprecated` +
          (sunset ? ` and will be removed after ${sunset}` : "") +
          (link ? `. See ${link}` : "")
      )
    }
    const usage = response.headers.get("nohead-usage-warning")
    if (usage && !warnedUsage) {
      warnedUsage = true
      console.warn(`[nohead] Over a plan limit: ${usage}`)
    }
  }
}

/** Seconds to wait before retrying `error`, or undefined to throw it. */
function retryDelay(
  error: APIError,
  attempt: number,
  maxRetries: number
): number | undefined {
  if (attempt >= maxRetries) return undefined
  const inProgress =
    error.status === 409 && error.details.some((d) => d.code === "in_progress")
  if (!inProgress && !RETRYABLE_STATUSES.has(error.status)) return undefined
  const retryAfter = retryAfterSeconds(error.headers)
  if (retryAfter === undefined) return backoff(attempt)
  return retryAfter <= MAX_RETRY_AFTER_SECONDS ? retryAfter : undefined
}

/** Exponential backoff with jitter: about 0.5 s, 1 s, 2 s… up to 8 s. */
function backoff(attempt: number): number {
  const base = Math.min(0.5 * 2 ** attempt, 8)
  return base * (1 - Math.random() * 0.25)
}

function sleep(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new AbortError("The request was aborted", { cause: signal.reason })
      )
      return
    }
    const timer = setTimeout(done, seconds * 1000)
    function done() {
      signal?.removeEventListener("abort", aborted)
      resolve()
    }
    function aborted() {
      clearTimeout(timer)
      reject(
        new AbortError("The request was aborted", { cause: signal!.reason })
      )
    }
    signal?.addEventListener("abort", aborted, { once: true })
  })
}

async function parseBody(
  response: Response,
  signal: AbortSignal,
  progress: () => void
): Promise<unknown> {
  const text = await readText(response, signal, progress)
  if (!text) return undefined
  if (!response.headers.get("content-type")?.includes("json")) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** The body's text, calling `progress` for each chunk that arrives. */
async function readText(
  response: Response,
  signal: AbortSignal,
  progress: () => void
): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  // A fetch ends the body when the signal aborts, but not every fetch is
  // the platform's.
  const cancel = () => void reader.cancel().catch(() => undefined)
  signal.addEventListener("abort", cancel, { once: true })
  const decoder = new TextDecoder()
  let text = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) return text + decoder.decode()
      progress()
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

/**
 * Query parameters as the API reads them: objects become `key[sub]=…`
 * (`filter[price][lt]=50`), arrays are comma-separated (`expand=author,tags`)
 * with `\,` for a comma inside a value and `\\` for a backslash, dates are
 * ISO 8601.
 */
export function appendQuery(
  params: URLSearchParams,
  value: unknown,
  key?: string
): void {
  if (value === undefined || value === null) return
  if (value instanceof Date) {
    params.append(key!, value.toISOString())
  } else if (Array.isArray(value)) {
    // Missing items are left out, as missing values are.
    const items = value.filter((item) => item !== undefined && item !== null)
    if (items.length > 0)
      params.append(
        key!,
        items.map((item) => scalar(item).replace(/[\\,]/g, "\\$&")).join(",")
      )
  } else if (typeof value === "object") {
    for (const [name, inner] of Object.entries(value)) {
      appendQuery(params, inner, key ? `${key}[${name}]` : name)
    }
  } else {
    params.append(key!, scalar(value))
  }
}

function scalar(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

// `nohead-typescript/0.1.0 node/26.9.0`, or none in a browser, which sends its
// own (Nohead-Client still names the SDK there).
const RUNTIME = runtimeVersion()
const USER_AGENT: Record<string, string> = {}
if (RUNTIME)
  USER_AGENT["User-Agent"] = `nohead-typescript/${VERSION} ${RUNTIME}`

function runtimeVersion(): string | undefined {
  const g = globalThis as {
    Bun?: { version?: string }
    Deno?: { version?: { deno?: string } }
    process?: { versions?: { node?: string } }
  }
  if (g.Bun?.version) return `bun/${g.Bun.version}`
  if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}`
  if (g.process?.versions?.node) return `node/${g.process.versions.node}`
  return undefined
}

/** `url` without trailing slashes, if it is an http or https URL. */
function baseUrlOf(url: string): string {
  // A loop, as a regex backtracks on long runs of slashes.
  let end = url.length
  while (end > 0 && url[end - 1] === "/") end--
  const base = url.slice(0, end)
  let protocol: string | undefined
  try {
    protocol = new URL(base).protocol
  } catch {
    // Not a URL at all.
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new NoheadError("baseUrl must be an http or https URL")
  }
  return base
}

/** Sets each header, replacing one of the same name in any case. */
function setHeaders(
  headers: Record<string, string>,
  values: Record<string, string> = {}
): void {
  for (const [name, value] of Object.entries(values)) {
    for (const key of Object.keys(headers))
      if (key.toLowerCase() === name.toLowerCase()) delete headers[key]
    headers[name] = value
  }
}

/** `ifMatch`'s revision: a number, or a record's or a draft's. */
function revisionOf(ifMatch: unknown): number {
  const revision = isObject(ifMatch) ? ifMatch.revision : ifMatch
  if (!Number.isInteger(revision)) {
    throw new TypeError(
      "ifMatch takes a revision number, or a record, draft or object with a revision"
    )
  }
  return revision as number
}

// JSON has no NaN or Infinity, which JSON.stringify would send as null.
function finiteNumbers(key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`JSON can't carry ${value}${key ? ` (in ${key})` : ""}`)
  }
  return value
}

function environment(): Record<string, string | undefined> {
  const process = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process
  return process?.env ?? {}
}
