import type { ErrorDetail, ErrorType } from "./generated/types.gen.ts"

/** The base class of every error this SDK throws. */
export class NoheadError extends Error {
  override name = "NoheadError"
}

/**
 * The API answered with an error status. Subclasses follow the error `type`.
 * Its `message` names the status, the type and the request's ID along with
 * the API's message: `422 validation_error: Title is required (request req_…)`.
 */
export class APIError extends NoheadError {
  override name = "APIError"
  /** The HTTP status. */
  readonly status: number
  /**
   * The error `type`, e.g. `validation_error`; undefined if the body had
   * none. A type newer than this SDK is kept as its string.
   */
  readonly type: ErrorType | (string & {}) | undefined
  /** The API's own message, without the status, type and ID `message` adds. */
  readonly apiMessage: string
  /** The request's ID (`req_…`), for support requests and logs. */
  readonly requestId: string | undefined
  /** Field-level details, e.g. `[{ field: "title", code: "required", … }]`. */
  readonly details: ErrorDetail[]
  readonly headers: Headers
  /** The parsed response body, or its text when it was not JSON. */
  readonly body: unknown

  constructor(status: number, body: unknown, headers: Headers) {
    // Below 400 (and not 2xx) is a redirect, which the SDK doesn't follow:
    // `0` is a browser's, which shows nothing of it.
    const error = status < 400 ? redirect(headers) : errorEnvelope(body)
    const requestId =
      error?.request_id ?? headers.get("x-request-id") ?? undefined
    const apiMessage = error?.message || `Request failed with status ${status}`
    super(
      `${status} ${error?.type || "error"}: ${apiMessage}` +
        (requestId ? ` (request ${requestId})` : "")
    )
    this.status = status
    this.apiMessage = apiMessage
    this.type = error?.type
    this.requestId = requestId
    this.details = error?.details ?? []
    this.headers = headers
    this.body = body
  }
}

export class InvalidRequestError extends APIError {
  override name = "InvalidRequestError"
}
export class AuthenticationError extends APIError {
  override name = "AuthenticationError"
}
export class PlanLimitExceededError extends APIError {
  override name = "PlanLimitExceededError"
}
export class AuthorizationError extends APIError {
  override name = "AuthorizationError"
}
export class NotFoundError extends APIError {
  override name = "NotFoundError"
}
export class ConflictError extends APIError {
  override name = "ConflictError"
}

/** An `ifMatch` revision was not the current one: reload and try again. */
export class PreconditionFailedError extends APIError {
  override name = "PreconditionFailedError"
  /** The resource's current revision, when the API reports it. */
  get currentRevision(): number | undefined {
    return this.details.find((d) => d.code === "revision_mismatch")
      ?.current_revision
  }
}

export class ValidationError extends APIError {
  override name = "ValidationError"
}

export class RateLimitError extends APIError {
  override name = "RateLimitError"
  /** Seconds to wait before retrying, from `Retry-After`. */
  get retryAfter(): number | undefined {
    return retryAfterSeconds(this.headers)
  }
}

export class InternalServerError extends APIError {
  override name = "InternalServerError"
}
export class ServiceUnavailableError extends APIError {
  override name = "ServiceUnavailableError"
}

/** The request never got a response: DNS, TLS, a reset connection. */
export class ConnectionError extends NoheadError {
  override name = "ConnectionError"
}

/** An attempt took longer than the `timeout` option. */
export class TimeoutError extends ConnectionError {
  override name = "TimeoutError"
}

/** The caller's `signal` aborted the request. */
export class AbortError extends NoheadError {
  override name = "AbortError"
}

/** A presigned upload to storage failed (`assets.upload`). */
export class UploadError extends NoheadError {
  override name = "UploadError"
  /** Storage's HTTP status, when it answered. */
  readonly status: number | undefined

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options)
    this.status = status
  }
}

/** A webhook request's signature or timestamp did not check out. */
export class WebhookVerificationError extends NoheadError {
  override name = "WebhookVerificationError"
}

// By error `type`, one class for each the SDK knows. A Map, so a lookup finds
// only these: a plain object would also find Object.prototype's
// (`constructor`, `toString`).
const CLASSES = new Map<string, typeof APIError>(
  Object.entries({
    invalid_request: InvalidRequestError,
    authentication_error: AuthenticationError,
    plan_limit_exceeded: PlanLimitExceededError,
    authorization_error: AuthorizationError,
    not_found: NotFoundError,
    conflict: ConflictError,
    precondition_failed: PreconditionFailedError,
    validation_error: ValidationError,
    rate_limited: RateLimitError,
    internal_error: InternalServerError,
    service_unavailable: ServiceUnavailableError,
  } satisfies Record<ErrorType, typeof APIError>)
)

/** The error for a response, by its `type`, or by status when it has none. */
export function apiError(
  status: number,
  body: unknown,
  headers: Headers
): APIError {
  if (status < 400) return new APIError(status, body, headers)
  const type = errorEnvelope(body)?.type
  const Class =
    (type && CLASSES.get(type)) ||
    (status === 503
      ? ServiceUnavailableError
      : status >= 500
        ? InternalServerError
        : APIError)
  return new Class(status, body, headers)
}

/**
 * `Retry-After` in seconds: a number of seconds (`120`, `1.5`), or an HTTP
 * date. Anything else (`-1`, `1e3`, `0x10`, an ISO 8601 time) is undefined,
 * as the Python and Ruby SDKs read it.
 */
export function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim()
  if (!value) return undefined
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value)
  const date = httpDate(value)
  return date === undefined
    ? undefined
    : Math.max(0, (date - Date.now()) / 1000)
}

// The three forms of an HTTP date (RFC 9110), all in GMT. Not Date.parse,
// which takes more than these, and asctime's in the local time zone.
const HTTP_DATES = [
  // IMF-fixdate: Sun, 06 Nov 1994 08:49:37 GMT
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?<day>\d{2}) (?<month>\w{3}) (?<year>\d{4}) (?<time>\d{2}:\d{2}:\d{2}) GMT$/,
  // RFC 850: Sunday, 06-Nov-94 08:49:37 GMT
  /^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, (?<day>\d{2})-(?<month>\w{3})-(?<year>\d{2}) (?<time>\d{2}:\d{2}:\d{2}) GMT$/,
  // asctime: Sun Nov  6 08:49:37 1994
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?<month>\w{3}) (?<day>[ \d]\d) (?<time>\d{2}:\d{2}:\d{2}) (?<year>\d{4})$/,
]
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")

/** An HTTP date in milliseconds, or undefined if `value` isn't one. */
function httpDate(value: string): number | undefined {
  const date = HTTP_DATES.map((pattern) => pattern.exec(value)?.groups).find(
    Boolean
  )
  const month = MONTHS.indexOf(date?.month ?? "")
  if (!date || month < 0) return undefined
  let year = Number(date.year)
  // RFC 850's two digits: the latest such year not over 50 years ahead.
  if (date.year!.length === 2) {
    year += 2000
    if (year > new Date().getUTCFullYear() + 50) year -= 100
  }
  const [hours, minutes, seconds] = date.time!.split(":").map(Number)
  return Date.UTC(year, month, Number(date.day), hours, minutes, seconds)
}

interface Envelope {
  type?: string
  message?: string
  request_id?: string
  details?: ErrorDetail[]
}

// The error envelope's fields that have the right type: a proxy or gateway
// in front of the API may answer with any JSON.
function errorEnvelope(body: unknown): Envelope | undefined {
  if (!isObject(body) || !isObject(body.error)) return undefined
  const { type, message, request_id, details } = body.error
  return {
    type: typeof type === "string" ? type : undefined,
    message: typeof message === "string" ? message : undefined,
    request_id: typeof request_id === "string" ? request_id : undefined,
    details: Array.isArray(details) ? details.map(errorDetail) : undefined,
  }
}

// A detail that isn't an object is kept as its text, so currentRevision can
// read every detail's fields.
function errorDetail(detail: unknown): ErrorDetail {
  if (isObject(detail) && !Array.isArray(detail)) return detail as ErrorDetail
  const message = typeof detail === "string" ? detail : JSON.stringify(detail)
  return { code: "unknown", message: String(message) }
}

// A redirect's error: following one would send the API key elsewhere, or a
// write as a GET.
function redirect(headers: Headers): Envelope {
  const location = headers.get("location")
  return {
    type: "redirect",
    message: `The API answered with a redirect${location ? ` to ${location}` : ""}; check the base URL`,
  }
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
