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
  /** A project API key (`sk_live_…`). Defaults to `NOHEAD_API_KEY`. */
  apiKey?: string
  /** Defaults to `NOHEAD_API_URL`, else `https://api.nohead.io`. */
  baseUrl?: string
  /** The key's project. Looked up once with `GET /v1/me` when omitted. */
  projectId?: string
  /** Retries of failed requests (see README, "Retries"). Default 2. */
  maxRetries?: number
  /** Milliseconds per attempt. Default 60 000. */
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
  /** A reason for the change, shown in history (`Nohead-Change-Note`). */
  changeNote?: string
  signal?: AbortSignal
  /** Milliseconds per attempt, overriding the client's. */
  timeout?: number
  /** Retries, overriding the client's. */
  maxRetries?: number
  headers?: Record<string, string>
}

/** Options of record writes that accept `If-Match`. */
export interface ConditionalRequestOptions extends RequestOptions {
  /**
   * Only write if the record is still at this revision; otherwise the API
   * answers `412` (`PreconditionFailedError`). A record works too.
   */
  ifMatch?: number | { revision: number }
}

export interface RequestInput {
  path?: Record<string, string | number | undefined>
  query?: object
  body?: unknown
}

type AllOptions = ConditionalRequestOptions

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_RETRY_AFTER_SECONDS = 60

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
  #projectId: Promise<string> | undefined

  constructor(options: ClientOptions) {
    const env = environment()
    // Empty environment variables count as unset.
    const apiKey = options.apiKey ?? (env.NOHEAD_API_KEY || undefined)
    if (!apiKey) {
      throw new NoheadError(
        "Missing API key: pass `apiKey` or set NOHEAD_API_KEY"
      )
    }
    this.#apiKey = apiKey
    this.#baseUrl = (
      options.baseUrl ??
      (env.NOHEAD_API_URL || DEFAULT_BASE_URL)
    ).replace(/\/+$/, "")
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#headers = options.headers ?? {}
    this.#maxRetries = options.maxRetries ?? 2
    this.#timeout = options.timeout ?? 60_000
    this.#warnings = options.warnings ?? true
    this.#onRetry = options.onRetry
    if (options.projectId) this.#projectId = Promise.resolve(options.projectId)
  }

  /** The API key's project, from `GET /v1/me` the first time. */
  projectId(): Promise<string> {
    this.#projectId ??= this.request("me_get", {}).then(
      (me) => {
        if (!me.api_key) {
          throw new NoheadError("The credentials are not a project API key")
        }
        return me.api_key.project_id
      },
      (error: unknown) => {
        this.#projectId = undefined
        throw error
      }
    )
    return this.#projectId
  }

  request<Op extends OperationId>(
    operation: Op,
    input: RequestInput = {},
    options: AllOptions = {}
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
      const page = new Page<Item, Meta>(list.data, list.meta, (next) =>
        fetchPage(next).then((r) => r.data)
      )
      return { ...result, data: page }
    }
    const first = (input.query as { cursor?: string } | undefined)?.cursor
    return new PagePromise(fetchPage(first))
  }

  /** `fetch` with this client's timeout and retries, for presigned URLs. */
  async fetchWithRetries(
    url: string,
    init: RequestInit,
    options: RequestOptions & { retry: boolean }
  ): Promise<Response> {
    const maxRetries = options.retry
      ? (options.maxRetries ?? this.#maxRetries)
      : 0
    for (let attempt = 0; ; attempt++) {
      let failed: { status?: number; error?: NoheadError }
      try {
        const { response } = await this.#attempt(url, init, options, false)
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
    options: AllOptions
  ): Promise<APIResponse<unknown>> {
    const { method, path } = OPERATIONS[operation]
    const url = new URL(this.#baseUrl + (await this.#path(path, input.path)))
    appendQuery(url.searchParams, input.query)

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.#apiKey}`,
      "Nohead-Client": `sdk-typescript/${VERSION}`,
      ...USER_AGENT,
      ...this.#headers,
    }
    if (input.body !== undefined) headers["Content-Type"] = "application/json"
    if (method !== "GET") {
      headers["Idempotency-Key"] = options.idempotencyKey ?? crypto.randomUUID()
    }
    if (options.ifMatch !== undefined) {
      const revision =
        typeof options.ifMatch === "object"
          ? options.ifMatch.revision
          : options.ifMatch
      headers["If-Match"] = `"${revision}"`
    }
    if (options.changeNote) headers["Nohead-Change-Note"] = options.changeNote
    Object.assign(headers, options.headers)

    const init: RequestInit = {
      method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
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
    const timeout = options.timeout ?? this.#timeout
    const timer = AbortSignal.timeout(timeout)
    const signal = options.signal
      ? AbortSignal.any([options.signal, timer])
      : timer
    try {
      const response = await this.#fetch(url, { ...init, signal })
      const body = readBody ? await parseBody(response) : undefined
      return { response, body }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new AbortError("The request was aborted", {
          cause: options.signal.reason,
        })
      }
      if (timer.aborted) {
        throw new TimeoutError(`The request timed out after ${timeout} ms`)
      }
      throw new ConnectionError(
        `Could not reach ${new URL(url).host}: ${(error as Error).message}`,
        { cause: error }
      )
    }
  }

  async #path(
    template: string,
    values: RequestInput["path"] = {}
  ): Promise<string> {
    let path = template
    for (const [, name] of template.matchAll(/\{(\w+)\}/g)) {
      let value = values[name!]
      if (value === undefined && name === "project_id") {
        value = await this.projectId()
      }
      if (value === undefined || value === "") {
        throw new NoheadError(`Missing ${name}`)
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

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  if (!response.headers.get("content-type")?.includes("json")) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
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
    if (value.length > 0)
      params.append(
        key!,
        value.map((item) => scalar(item).replace(/[\\,]/g, "\\$&")).join(",")
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

function environment(): Record<string, string | undefined> {
  const process = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process
  return process?.env ?? {}
}
