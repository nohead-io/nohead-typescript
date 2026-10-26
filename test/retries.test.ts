import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AbortError,
  ConnectionError,
  InternalServerError,
  RateLimitError,
  TimeoutError,
  type RetryEvent,
} from "../src/index.ts"
import {
  apiError,
  json,
  mockClient,
  raw,
  record,
  settle,
  type Call,
} from "./helpers.ts"

const now = { "retry-after": "0" }

// Answers only when the request's signal aborts it, as fetch does.
const hang = (call: Call) =>
  new Promise<Response>((_, reject) => {
    // fetch rejects with the signal's reason (an AbortError DOMException).
    const abort = () => reject(call.signal!.reason as Error)
    if (call.signal?.aborted) abort()
    call.signal?.addEventListener("abort", abort)
  })

/**
 * A record whose body arrives in `parts`, one every `every` ms. The
 * request's signal ends it, as fetch's does.
 */
const drip = (parts: number, every: number) => (call: Call) => {
  const text = JSON.stringify(record("rec_1"))
  const size = Math.ceil(text.length / parts)
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      call.signal?.addEventListener("abort", () =>
        controller.error(call.signal!.reason)
      )
    },
    pull: (controller) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(text.slice(sent, sent + size))
          )
          sent += size
          if (sent >= text.length) controller.close()
          resolve()
        }, every)
      ),
  })
  return raw(
    new Response(body, { headers: { "content-type": "application/json" } })
  )
}

/**
 * The start of a body, then nothing; the signal doesn't end it, as a fetch
 * that isn't the platform's may not.
 */
const stall = () =>
  raw(
    new Response(
      new ReadableStream({
        start: (controller) => controller.enqueue(new Uint8Array([123])),
      }),
      { headers: { "content-type": "application/json" } }
    )
  )

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

  it.each([
    "Fri, 02 Oct 2026 12:00:05 GMT",
    "Friday, 02-Oct-26 12:00:05 GMT",
    "Fri Oct  2 12:00:05 2026",
  ])("reads the Retry-After date %j, in GMT", async (date) => {
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"))
    const { onRetry, delays } = retryDelays()
    const { nohead } = mockClient(
      [
        apiError(429, "rate_limited", {}, { "retry-after": date }),
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

  it("doesn't time out a response that keeps arriving", async () => {
    // Real time: 150 ms in all, three times the timeout.
    vi.useRealTimers()
    const { nohead, calls } = mockClient([drip(5, 30)], {
      maxRetries: 0,
      timeout: 50,
    })
    expect((await nohead.records.get("rec_1")).id).toBe("rec_1")
    expect(calls).toHaveLength(1)
  })

  it("times out a response that stalls", async () => {
    const { nohead } = mockClient([stall], {
      maxRetries: 0,
      timeout: 10,
    })
    const error = await settle(nohead.records.get("rec_1")).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(TimeoutError)
    expect((error as Error).message).toBe("The request timed out after 10 ms")
  })

  it("aborts a response the caller stops reading", async () => {
    const controller = new AbortController()
    const { nohead } = mockClient([stall])
    const outcome = nohead.records
      .get("rec_1", {}, { signal: controller.signal })
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(100)
    controller.abort()
    expect(await outcome).toBeInstanceOf(AbortError)
  })

  it("retries a timeout", async () => {
    const { nohead, calls } = mockClient([hang, json(200, record("rec_1"))], {
      timeout: 10,
    })
    expect((await settle(nohead.records.get("rec_1"))).id).toBe("rec_1")
    expect(calls).toHaveLength(2)
  })

  it.each([
    ["before the request", 0],
    ["while it runs", 1],
  ])("stops when the caller aborts %s", async (_, after) => {
    const controller = new AbortController()
    if (!after) controller.abort()
    const { nohead, calls } = mockClient([hang, json(200, record("rec_1"))])
    const outcome = nohead.records
      .get("rec_1", {}, { signal: controller.signal })
      .then(
        () => undefined,
        (error: unknown) => error
      )
    await vi.advanceTimersByTimeAsync(after)
    controller.abort()
    expect(await outcome).toBeInstanceOf(AbortError)
    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(1)
  })

  it("stops when the caller aborts while it waits to retry", async () => {
    const controller = new AbortController()
    const { nohead, calls } = mockClient([
      apiError(429, "rate_limited", {}, { "retry-after": "30" }),
      json(200, record("rec_1")),
    ])
    const outcome = nohead.records
      .get("rec_1", {}, { signal: controller.signal })
      .then(
        () => undefined,
        (error: unknown) => error
      )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toHaveLength(1)
    controller.abort()
    expect(await outcome).toBeInstanceOf(AbortError)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(1)
  })
})

describe("what's retried", () => {
  it.each([
    [400, "invalid_request", null, false],
    [401, "authentication_error", null, false],
    [402, "plan_limit_exceeded", null, false],
    [403, "authorization_error", null, false],
    [404, "not_found", null, false],
    [409, "conflict", null, false],
    [409, "conflict", "draft_exists", false],
    [409, "conflict", "in_progress", true],
    [412, "precondition_failed", null, false],
    [422, "validation_error", null, false],
    [429, "rate_limited", null, true],
    [500, "internal_error", null, true],
    [502, "internal_error", null, true],
    [503, "service_unavailable", null, true],
    [504, "internal_error", null, true],
  ])("%i %s, detail %s: retried %s", async (status, type, code, retried) => {
    const details = code ? [{ code, message: "…" }] : []
    const { nohead, calls } = mockClient([
      apiError(status, type, { details }, now),
      json(201, record("rec_1")),
    ])
    const outcome = await settle(
      nohead.records.create("posts", { data: {} })
    ).catch((error: unknown) => error)
    expect(calls).toHaveLength(retried ? 2 : 1)
    if (retried) expect(outcome).toMatchObject({ id: "rec_1" })
    else expect(outcome).toMatchObject({ status, type })
  })

  it.each([
    [429, "rate_limited", "7", [7]],
    [503, "service_unavailable", "7", [7]],
    [429, "rate_limited", "60", [60]],
    [503, "service_unavailable", "60", [60]],
    [429, "rate_limited", "61", []],
    [503, "service_unavailable", "61", []],
    [503, "service_unavailable", " 1.5 ", [1.5]],
    // Not seconds or a date: backoff, as without one.
    [503, "service_unavailable", "soon", [0.5]],
    [503, "service_unavailable", "-1", [0.5]],
    [503, "service_unavailable", "1e3", [0.5]],
    [503, "service_unavailable", "0x10", [0.5]],
    [503, "service_unavailable", "inf", [0.5]],
    [503, "service_unavailable", "nan", [0.5]],
    [503, "service_unavailable", "2026-10-02T12:00:05Z", [0.5]],
  ])(
    "%i %s with Retry-After %s waits %o",
    async (status, type, after, waits) => {
      vi.spyOn(Math, "random").mockReturnValue(0)
      const { onRetry, delays } = retryDelays()
      const { nohead, calls } = mockClient(
        [
          apiError(status, type, {}, { "retry-after": after }),
          json(200, record("rec_1")),
        ],
        { onRetry }
      )
      const outcome = await settle(nohead.records.get("rec_1")).catch(
        (error: unknown) => error
      )
      expect(delays()).toEqual(waits)
      expect(calls).toHaveLength(waits.length + 1)
      if (waits.length === 0) expect(outcome).toMatchObject({ status })
    }
  )

  it.each([
    ["a connection failure", new TypeError("fetch failed")],
    ["a timeout", hang],
  ])(
    "sends a write again after %s with the same idempotency key",
    async (_, failure) => {
      const { nohead, calls } = mockClient(
        [failure, json(201, record("rec_1"))],
        { timeout: 10 }
      )
      await settle(nohead.records.create("posts", { data: {} }))
      expect(calls).toHaveLength(2)
      const [first, second] = calls.map((c) => c.headers.get("idempotency-key"))
      expect(first).toMatch(/^[0-9a-f-]{36}$/)
      expect(second).toBe(first)
    }
  )
})
