import { createHmac } from "node:crypto"
import { describe, expect, it } from "vitest"

import { unwrapWebhook } from "../src/webhooks.ts"
import { WebhookVerificationError } from "../src/index.ts"
import { mockClient } from "./helpers.ts"

const secret = `whsec_${Buffer.from("a-very-secret-key").toString("base64")}`
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

function sign(
  payload: string,
  timestamp = Math.floor(Date.now() / 1000),
  id = "msg_1"
) {
  const key = Buffer.from(secret.slice("whsec_".length), "base64")
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

  it.each([
    ["a changed body", () => [body.replace("Hi", "Bye"), sign(body)] as const],
    ["a wrong secret", () => [body, sign(body.replace("Hi", "x"))] as const],
    [
      "an old timestamp",
      () => [body, sign(body, Math.floor(Date.now() / 1000) - 600)] as const,
    ],
    ["missing headers", () => [body, {}] as const],
  ])("rejects %s", async (_, input) => {
    const [payload, headers] = input()
    await expect(
      unwrapWebhook(payload, headers, { secret })
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })
})
