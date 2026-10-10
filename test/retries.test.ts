import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AbortError,
  ConnectionError,
  InternalServerError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  type RetryEvent,
} from "../src/index.ts"
import {
  apiError,
  json,
  mockClient,
  record,
  settle,
  type Call,
} from "./helpers.ts"

const now = { "retry-after": "0" }

// Answers only when the request's signal aborts it, as fetch does.
const hang = (call: Call) =>
  new Promise<Response>((_, reject) => {
    // fetch rejects with the signal's reason (an AbortError DOMException).
    call.signal?.addEventListener("abort", () =>
      reject(call.signal!.reason as Error)
    )
  })

// The waits between attempts take no time; `settle` runs them.
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** The delays a call waited before each retry. */
function retryDelays() {
  const events: RetryEvent[] = []
  const onRetry = (event: RetryEvent) => events.push(event)
  return { onRetry, delays: () => events.map((e) => e.delay) }
}

describe("retries", () => {
  it("retries server errors with the same idempotency key", async () => {
    const { nohead, calls } = mockClient([
      apiError(500, "internal_error", {}, now),
      apiError(503, "service_unavailable", {}, now),
      json(201, record("rec_1")),
    ])
    const created = await settle(nohead.records.create("posts", { data: {} }))
    expect(created.id).toBe("rec_1")
    expect(calls).toHaveLength(3)
    expect(
      new Set(calls.map((c) => c.headers.get("idempotency-key"))).size
    ).toBe(1)
  })

  it.each([502, 504])("retries %i", async (status) => {
    const { nohead, calls } = mockClient([
      apiError(status, "internal_error"),
      json(200, record("rec_1")),
    ])
    await settle(nohead.records.get("rec_1"))
    expect(calls).toHaveLength(2)
  })

  it("gives up after the default two retries", async () => {
    const { nohead, calls } = mockClient([apiError(500, "internal_error")])
    await expect(settle(nohead.records.get("rec_1"))).rejects.toBeInstanceOf(
      InternalServerError
    )
    expect(calls).toHaveLength(3)
  })

  it("backs off exponentially with jitter, up to 8 s", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5) // 12.5% off each delay
    const { onRetry, delays } = retryDelays()
    const { nohead } = mockClient([apiError(500, "internal_error")], {
      maxRetries: 6,
      onRetry,
    })
    await settle(nohead.records.get("rec_1")).catch(() => undefined)
    expect(delays()).toEqual([0.4375, 0.875, 1.75, 3.5, 7, 7])
  })

  it("reports each retry to onRetry", async () => {
    const onRetry = vi.fn()
    const { nohead } = mockClient(
      [
        apiError(429, "rate_limited", {}, now),
        new TypeError("fetch failed"),
        json(200, record("rec_1")),
      ],
      { onRetry }
    )
    await settle(nohead.records.get("rec_1"))
    expect(onRetry).toHaveBeenCalledTimes(2)
    const [first, second] = onRetry.mock.calls.map(([event]) => event)
    expect(first).toMatchObject({ attempt: 1, delay: 0, status: 429 })
    expect(first.error).toBeInstanceOf(RateLimitError)
    expect(first.url).toBe("https://api.test/v1/records/rec_1")
    expect(second.attempt).toBe(2)
    expect(second.status).toBeUndefined()
    expect(second.error).toBeInstanceOf(ConnectionError)
  })

  it("waits out a short Retry-After", async () => {
    const { nohead, calls } = mockClient([
      apiError(429, "rate_limited", {}, { "retry-after": "3" }),
      json(200, record("rec_1")),
    ])
    const got = nohead.records.get("rec_1")
    await vi.advanceTimersByTimeAsync(2999)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await got
    expect(calls).toHaveLength(2)
  })

  it("reads a Retry-After date", async () => {
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"))
    const { onRetry, delays } = retryDelays()
    const { nohead } = mockClient(
      [
        apiError(
          429,
          "rate_limited",
          {},
          { "retry-after": "Fri, 02 Oct 2026 12:00:05 GMT" }
        ),
        json(200, record("rec_1")),
      ],
      { onRetry }
    )
    await settle(nohead.records.get("rec_1"))
    expect(delays()).toEqual([5])
  })

  it("backs off on a 429 without Retry-After", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    const { onRetry, delays } = retryDelays()
    const { nohead, calls } = mockClient(
      [apiError(429, "rate_limited"), json(200, record("rec_1"))],
      { onRetry }
    )
    await settle(nohead.records.get("rec_1"))
    expect(delays()).toEqual([0.5])
    expect(calls).toHaveLength(2)
  })

  it("gives up at once on a long Retry-After", async () => {
    const { nohead, calls } = mockClient([
      apiError(429, "rate_limited", {}, { "retry-after": "120" }),
    ])
    await expect(nohead.records.get("rec_1")).rejects.toBeInstanceOf(
      RateLimitError
    )
    expect(calls).toHaveLength(1)
  })

  it("retries an idempotent request that is still in progress", async () => {
    const { nohead, calls } = mockClient([
      apiError(
        409,
        "conflict",
        { details: [{ code: "in_progress", message: "…" }] },
        now
      ),
      json(201, record("rec_1")),
    ])
    await settle(nohead.records.create("posts", { data: {} }))
    expect(calls).toHaveLength(2)
  })

  it("does not retry other client errors", async () => {
    const { nohead, calls } = mockClient([apiError(422, "validation_error")])
    await expect(
      nohead.records.create("posts", { data: {} })
    ).rejects.toBeInstanceOf(ValidationError)
    expect(calls).toHaveLength(1)
  })

  it("retries connection failures", async () => {
    const { nohead, calls } = mockClient([
      new TypeError("fetch failed"),
      json(200, record("rec_1")),
    ])
    await settle(nohead.records.get("rec_1"))
    expect(calls).toHaveLength(2)
  })

  it("stops after maxRetries", async () => {
    const { nohead, calls } = mockClient([new TypeError("fetch failed")], {
      maxRetries: 0,
    })
    await expect(nohead.records.get("rec_1")).rejects.toBeInstanceOf(
      ConnectionError
    )
    expect(calls).toHaveLength(1)
  })

  it("takes maxRetries and timeout per call", async () => {
    const { nohead, calls } = mockClient([hang])
    await expect(
      settle(nohead.records.get("rec_1", {}, { maxRetries: 0, timeout: 10 }))
    ).rejects.toBeInstanceOf(TimeoutError)
    expect(calls).toHaveLength(1)
  })

  it("times out slow attempts", async () => {
    const { nohead } = mockClient([hang], { maxRetries: 0, timeout: 10 })
    await expect(settle(nohead.records.get("rec_1"))).rejects.toBeInstanceOf(
      TimeoutError
    )
  })

  it("retries a timeout", async () => {
    const { nohead, calls } = mockClient([hang, json(200, record("rec_1"))], {
      timeout: 10,
    })
    expect((await settle(nohead.records.get("rec_1"))).id).toBe("rec_1")
    expect(calls).toHaveLength(2)
  })

  it("stops when the caller aborts", async () => {
    const controller = new AbortController()
    controller.abort()
    const { nohead } = mockClient([new DOMException("aborted", "AbortError")])
    await expect(
      nohead.records.get("rec_1", {}, { signal: controller.signal })
    ).rejects.toBeInstanceOf(AbortError)
  })
})
