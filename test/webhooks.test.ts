import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { unwrapWebhook } from "../src/webhooks.ts"
import { WebhookVerificationError } from "../src/index.ts"
import { mockClient } from "./helpers.ts"

const secret = `whsec_${Buffer.from("a-very-secret-key").toString("base64")}`
const otherSecret = `whsec_${Buffer.from("another-secret-key").toString("base64")}`
const body = JSON.stringify({
  id: "wev_1",
  object: "event",
  type: "record.published",
  created_at: "2026-10-02T12:00:00.000Z",
  project_id: "prj_1",
  data: {
    record: { id: "rec_1", data: { title: "Hi" } },
    revision: 2,
    revision_id: "rev_1",
  },
})

// The clock, frozen for each test.
const now = Date.parse("2026-10-02T12:00:00Z") / 1000
beforeEach(() => {
  vi.useFakeTimers({ now: now * 1000, toFake: ["Date"] })
})
afterEach(() => {
  vi.useRealTimers()
})

function sign(
  payload: string,
  { timestamp = now, id = "msg_1", signingSecret = secret } = {}
) {
  const key = Buffer.from(signingSecret.slice("whsec_".length), "base64")
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64")
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${signature}`,
  }
}

describe("webhook verification", () => {
  it("verifies the Standard Webhooks spec's example", async () => {
    vi.setSystemTime(1614265330 * 1000)
    const event = await unwrapWebhook(
      '{"test": 2432232314}',
      {
        "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
        "webhook-timestamp": "1614265330",
        "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
      },
      { secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw" }
    )
    expect(event).toEqual({ test: 2432232314 })
  })

  it("returns the event of a correctly signed request", async () => {
    const event = await unwrapWebhook(body, new Headers(sign(body)), { secret })
    expect(event.type).toBe("record.published")
    if (event.type === "record.published") expect(event.data.revision).toBe(2)
  })

  it("accepts Node-style headers, raw bytes and several signatures", async () => {
    const headers = sign(body)
    headers["webhook-signature"] = `v1,bm90LWl0 ${headers["webhook-signature"]}`
    const event = await unwrapWebhook(
      new TextEncoder().encode(body),
      { ...headers, "X-Other": undefined },
      { secret }
    )
    expect(event.id).toBe("wev_1")
  })

  it("works from the client too", async () => {
    const { nohead } = mockClient([])
    const event = await nohead.webhooks.unwrap(body, sign(body), { secret })
    expect(event.project_id).toBe("prj_1")
  })

  it("accepts timestamps up to the tolerance off", async () => {
    for (const timestamp of [now - 300, now + 300]) {
      const event = await unwrapWebhook(body, sign(body, { timestamp }), {
        secret,
      })
      expect(event.id).toBe("wev_1")
    }
    const old = sign(body, { timestamp: now - 600 })
    await expect(
      unwrapWebhook(body, old, { secret, tolerance: 600 })
    ).resolves.toMatchObject({ id: "wev_1" })
    await expect(
      unwrapWebhook(body, old, { secret, tolerance: 599 })
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it.each([
    ["a changed body", () => [body.replace("Hi", "Bye"), sign(body)] as const],
    [
      "a changed webhook-id",
      () => [body, { ...sign(body), "webhook-id": "msg_2" }] as const,
    ],
    [
      "a signature of another version",
      () => {
        const headers = sign(body)
        headers["webhook-signature"] = headers["webhook-signature"].replace(
          "v1,",
          "v2,"
        )
        return [body, headers] as const
      },
    ],
    [
      "a wrong secret",
      () => [body, sign(body, { signingSecret: otherSecret })] as const,
    ],
    [
      "an old timestamp",
      () => [body, sign(body, { timestamp: now - 301 })] as const,
    ],
    [
      "a future timestamp",
      () => [body, sign(body, { timestamp: now + 301 })] as const,
    ],
    [
      "a timestamp that isn't a number",
      () => [body, { ...sign(body), "webhook-timestamp": "soon" }] as const,
    ],
    ["missing headers", () => [body, {}] as const],
    ["a body that isn't JSON", () => ["not json", sign("not json")] as const],
  ])("rejects %s", async (_, input) => {
    const [payload, headers] = input()
    await expect(
      unwrapWebhook(payload, headers, { secret })
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it("rejects a secret that isn't base64", async () => {
    const error = await unwrapWebhook(body, sign(body), {
      secret: "whsec_not base64!",
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as Error).message).toMatch("not base64")
  })
})
