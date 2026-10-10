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
import { apiError, mockClient } from "./helpers.ts"

const noRetries = { maxRetries: 0 }

async function failure(response: Response) {
  const { nohead } = mockClient([response], noRetries)
  return nohead.records.get("rec_1").then(
    () => {
      throw new Error("expected an error")
    },
    (error: unknown) => error
  )
}

describe("errors", () => {
  it.each([
    [400, "invalid_request", InvalidRequestError],
    [401, "authentication_error", AuthenticationError],
    [402, "plan_limit_exceeded", PlanLimitExceededError],
    [403, "authorization_error", AuthorizationError],
    [404, "not_found", NotFoundError],
    [409, "conflict", ConflictError],
    [412, "precondition_failed", PreconditionFailedError],
    [422, "validation_error", ValidationError],
    [429, "rate_limited", RateLimitError],
    [500, "internal_error", InternalServerError],
    [503, "service_unavailable", ServiceUnavailableError],
  ])("maps %i %s to its class", async (status, type, Class) => {
    const error = await failure(apiError(status, type, {}, { "x-a": "b" }))
    expect(error).toBeInstanceOf(Class)
    expect(error).toBeInstanceOf(APIError)
    expect(error).toMatchObject({ status, type, requestId: "req_1" })
    expect((error as APIError).headers.get("x-a")).toBe("b")
  })

  it("carries details", async () => {
    const error = (await failure(
      apiError(422, "validation_error", {
        details: [
          { field: "title", code: "required", message: "Title is required" },
        ],
      })
    )) as ValidationError
    expect(error.message).toBe("validation_error message")
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
      new Response("<html>Bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html", "x-request-id": "req_9" },
      })
    )) as APIError
    expect(error).toBeInstanceOf(InternalServerError)
    expect(error.body).toBe("<html>Bad gateway</html>")
    expect(error.requestId).toBe("req_9")
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
      new Response(JSON.stringify(body), {
        status: 502,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_9",
        },
      })
    )) as APIError
    expect(error).toBeInstanceOf(InternalServerError)
    expect(error.message).toBe("Request failed with status 502")
    expect(error.type).toBeUndefined()
    expect(error.requestId).toBe("req_9")
    expect(error.details).toEqual([])
  })

  it("keeps only details that are objects", async () => {
    const detail = {
      code: "revision_mismatch",
      message: "x",
      current_revision: 7,
    }
    const error = (await failure(
      apiError(412, "precondition_failed", { details: [null, 1, "x", detail] })
    )) as PreconditionFailedError
    expect(error.details).toEqual([detail])
    expect(error.currentRevision).toBe(7)
  })

  it.each(["constructor", "toString", "__proto__"])(
    "maps a %s type to APIError, not to Object's",
    async (type) => {
      const error = await failure(apiError(400, type))
      expect((error as APIError).constructor).toBe(APIError)
      expect((error as APIError).type).toBe(type)
    }
  )

  it("keeps unknown error types as APIError", async () => {
    const error = await failure(apiError(418, "teapot_error"))
    expect(error).toBeInstanceOf(APIError)
    expect((error as APIError).constructor).toBe(APIError)
    expect((error as APIError).type).toBe("teapot_error")
  })
})
