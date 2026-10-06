import { describe, expect, it, vi } from "vitest"

import {
  AbortError,
  ConnectionError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from "../src/index.ts"
import { apiError, json, mockClient, record } from "./helpers.ts"

const now = { "retry-after": "0" }

describe("retries", () => {
  it("retries server errors with the same idempotency key", async () => {
    const { nohead, calls } = mockClient([
      apiError(500, "internal_error", {}, now),
      apiError(503, "service_unavailable", {}, now),
      json(201, record("rec_1")),
    ])
    const created = await nohead.records.create("posts", { data: {} })
    expect(created.id).toBe("rec_1")
    expect(calls).toHaveLength(3)
    expect(
      new Set(calls.map((c) => c.headers.get("idempotency-key"))).size
    ).toBe(1)
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
    await nohead.records.get("rec_1")
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
    vi.useFakeTimers()
    try {
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
    } finally {
      vi.useRealTimers()
    }
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
    await nohead.records.create("posts", { data: {} })
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
    await nohead.records.get("rec_1")
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

  it("times out slow attempts", async () => {
    const slow = (call: { headers: Headers }) =>
      new Promise<Response>((_, reject) => {
        void call
        setTimeout(() => reject(new DOMException("aborted", "AbortError")), 50)
      })
    const { nohead } = mockClient([slow], { maxRetries: 0, timeout: 10 })
    await expect(nohead.records.get("rec_1")).rejects.toBeInstanceOf(
      TimeoutError
    )
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
