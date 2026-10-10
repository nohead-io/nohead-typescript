import type { ErrorDetail, ErrorType } from "./generated/types.gen.ts"

/** The base class of every error this SDK throws. */
export class NoheadError extends Error {
  override name = "NoheadError"
}

/** The API answered with an error status. Subclasses follow the error `type`. */
export class APIError extends NoheadError {
  override name = "APIError"
  /** The HTTP status. */
  readonly status: number
  /** The error `type`, e.g. `validation_error`; undefined if the body had none. */
  readonly type: ErrorType | undefined
  /** The request's ID (`req_…`), for support requests and logs. */
  readonly requestId: string | undefined
  /** Field-level details, e.g. `[{ field: "title", code: "required", … }]`. */
  readonly details: ErrorDetail[]
  readonly headers: Headers
  /** The parsed response body, or its text when it was not JSON. */
  readonly body: unknown

  constructor(status: number, body: unknown, headers: Headers) {
    const error = errorEnvelope(body)
    super(error?.message ?? `Request failed with status ${status}`)
    this.status = status
    this.type = error?.type
    this.requestId =
      error?.request_id ?? headers.get("x-request-id") ?? undefined
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

const CLASSES: Partial<Record<ErrorType, typeof APIError>> = {
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
}

/** The error for a response, by its `type`, or by status when it has none. */
export function apiError(
  status: number,
  body: unknown,
  headers: Headers
): APIError {
  const type = errorEnvelope(body)?.type
  const Class =
    (type && CLASSES[type]) ||
    (status === 503
      ? ServiceUnavailableError
      : status >= 500
        ? InternalServerError
        : APIError)
  return new Class(status, body, headers)
}

export function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after")
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const date = Date.parse(value)
  return Number.isNaN(date)
    ? undefined
    : Math.max(0, (date - Date.now()) / 1000)
}

interface Envelope {
  type?: ErrorType
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
    type: typeof type === "string" ? (type as ErrorType) : undefined,
    message: typeof message === "string" ? message : undefined,
    request_id: typeof request_id === "string" ? request_id : undefined,
    details: Array.isArray(details) ? (details as ErrorDetail[]) : undefined,
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null
