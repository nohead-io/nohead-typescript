import { describe, expect, it } from "vitest"

import {
  APIError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  InternalServerError,
  InvalidRequestError,
  NotFoundError,
  PlanLimitExceededError,
  PreconditionFailedError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
} from "../src/index.ts"
import type { ErrorType } from "../src/generated/types.gen.ts"
import { apiError, mockClient, raw } from "./helpers.ts"
import { spec } from "./spec.ts"

const noRetries = { maxRetries: 0 }

// A record's creation, which documents every 4xx an error type has.
async function failure(response: Response) {
  const { nohead } = mockClient([response], noRetries)
  return nohead.records.create("posts", { data: {} }).then(
    () => {
      throw new Error("expected an error")
    },
    (error: unknown) => error
  )
}

// Each error type's class, and a status it comes with.
const CLASSES: Record<ErrorType, [number, typeof APIError]> = {
  invalid_request: [400, InvalidRequestError],
  authentication_error: [401, AuthenticationError],
  plan_limit_exceeded: [402, PlanLimitExceededError],
  authorization_error: [403, AuthorizationError],
  not_found: [404, NotFoundError],
  conflict: [409, ConflictError],
  precondition_failed: [412, PreconditionFailedError],
  validation_error: [422, ValidationError],
  rate_limited: [429, RateLimitError],
  internal_error: [500, InternalServerError],
  service_unavailable: [503, ServiceUnavailableError],
}

describe("errors", () => {
  it.each(spec.components.schemas.ErrorType.enum as string[])(
    "maps the contract's %s to its own class",
    async (type) => {
      expect(CLASSES, `no class for ${type}`).toHaveProperty(type)
      const [status, Class] = CLASSES[type as ErrorType]
      expect(Class).not.toBe(APIError)
      const others = Object.entries(CLASSES).filter(([t]) => t !== type)
      expect(others.map(([, [, c]]) => c)).not.toContain(Class)
      const error = await failure(apiError(status, type, {}, { "x-a": "b" }))
      expect((error as APIError).constructor).toBe(Class)
      expect(error).toBeInstanceOf(APIError)
      expect(error).toMatchObject({ status, type, requestId: "req_1" })
      expect((error as APIError).headers.get("x-a")).toBe("b")
    }
  )

  it("names the status, type and request ID in its message", async () => {
    const error = await failure(apiError(404, "not_found"))
    expect((error as APIError).message).toBe(
      "404 not_found: not_found message (request req_1)"
    )
    expect(String(error)).toBe(
      "NotFoundError: 404 not_found: not_found message (request req_1)"
    )
  })

  it("carries details", async () => {
    const error = (await failure(
      apiError(422, "validation_error", {
        details: [
          { field: "title", code: "required", message: "Title is required" },
        ],
      })
    )) as ValidationError
    expect(error.message).toBe(
      "422 validation_error: validation_error message (request req_1)"
    )
    expect(error.apiMessage).toBe("validation_error message")
    expect(error.details).toEqual([
      { field: "title", code: "required", message: "Title is required" },
    ])
  })

  it("reports the current revision of a 412", async () => {
    const error = (await failure(
      apiError(412, "precondition_failed", {
        details: [
          {
            code: "revision_mismatch",
            message: "Current revision is 7",
            current_revision: 7,
          },
        ],
      })
    )) as PreconditionFailedError
    expect(error.currentRevision).toBe(7)
  })

  it("reads Retry-After", async () => {
    const error = (await failure(
      apiError(429, "rate_limited", {}, { "retry-after": "30" })
    )) as RateLimitError
    expect(error.retryAfter).toBe(30)
  })

  it("falls back to the status for bodies that are not API errors", async () => {
    const error = (await failure(
      raw(
        new Response("<html>Bad gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html", "x-request-id": "req_9" },
        })
      )
    )) as APIError
    expect(error).toBeInstanceOf(InternalServerError)
    expect(error.body).toBe("<html>Bad gateway</html>")
    expect(error.requestId).toBe("req_9")
    expect(error.message).toBe(
      "502 error: Request failed with status 502 (request req_9)"
    )
  })

  it("ignores error fields of the wrong type", async () => {
    // A gateway's JSON that looks like an envelope but is not one.
    const body = {
      error: {
        type: 5,
        message: { text: "x" },
        request_id: 7,
        details: "none",
      },
    }
    const error = (await failure(
      raw(
        new Response(JSON.stringify(body), {
          status: 502,
          headers: {
            "content-type": "application/json",
            "x-request-id": "req_9",
          },
        })
      )
    )) as APIError
    expect(error).toBeInstanceOf(InternalServerError)
    expect(error.message).toBe(
      "502 error: Request failed with status 502 (request req_9)"
    )
    expect(error.type).toBeUndefined()
    expect(error.requestId).toBe("req_9")
    expect(error.details).toEqual([])
  })

  it("keeps details that aren't objects as their text", async () => {
    const detail = {
      code: "revision_mismatch",
      message: "x",
      current_revision: 7,
    }
    const error = (await failure(
      raw(
        apiError(412, "precondition_failed", {
          details: [null, 1, "x", [2], detail],
        })
      )
    )) as PreconditionFailedError
    expect(error.details).toEqual([
      { code: "unknown", message: "null" },
      { code: "unknown", message: "1" },
      { code: "unknown", message: "x" },
      { code: "unknown", message: "[2]" },
      detail,
    ])
    expect(error.currentRevision).toBe(7)
  })

  it.each([
    [
      "https://api.nohead.io/v1/records/rec_1",
      "301 redirect: The API answered with a redirect to https://api.nohead.io/v1/records/rec_1; check the base URL",
    ],
    [
      undefined,
      "301 redirect: The API answered with a redirect; check the base URL",
    ],
  ])("refuses a redirect to %s", async (location, message) => {
    const { nohead, calls } = mockClient([
      raw(
        new Response(null, {
          status: 301,
          headers: location ? { location } : {},
        })
      ),
    ])
    const error = await nohead.records.create("posts", { data: {} }).then(
      () => undefined,
      (e: unknown) => e
    )
    expect((error as APIError).constructor).toBe(APIError)
    expect(error).toMatchObject({ status: 301, type: "redirect", message })
    // Not followed, and not retried.
    expect(calls).toHaveLength(1)
    expect(calls[0]!.init.redirect).toBe("manual")
  })

  it.each(["constructor", "toString", "__proto__"])(
    "maps a %s type to APIError, not to Object's",
    async (type) => {
      const error = await failure(raw(apiError(400, type)))
      expect((error as APIError).constructor).toBe(APIError)
      expect((error as APIError).type).toBe(type)
    }
  )

  it("keeps unknown error types as APIError", async () => {
    const error = await failure(raw(apiError(418, "teapot_error")))
    expect(error).toBeInstanceOf(APIError)
    expect((error as APIError).constructor).toBe(APIError)
    expect((error as APIError).type).toBe("teapot_error")
  })
})
