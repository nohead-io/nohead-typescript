import {
  Webhook,
  WebhookVerificationError as StandardVerificationError,
} from "standardwebhooks"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest"

import { unwrapWebhook } from "../src/webhooks.ts"
import { WebhookVerificationError, type NoheadDraft } from "../src/index.ts"
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

const official = new Webhook(secret)

/** The headers of a request the official library signs. */
function sign(
  payload: string,
  { timestamp = now, id = "msg_1", signingSecret = secret } = {}
): Record<string, string> {
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": new Webhook(signingSecret).sign(
      id,
      new Date(timestamp * 1000),
      payload
    ),
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

  it("types a draft event's draft by the record data", async () => {
    interface Post {
      title: string
    }
    const payload = JSON.stringify({
      ...JSON.parse(body),
      type: "draft.updated",
      data: {
        draft: { id: "drf_1", data: { title: "Hi" } },
        draft_id: "drf_1",
        record_id: "rec_1",
      },
    })
    const event = await unwrapWebhook<Post>(payload, sign(payload), { secret })
    if (event.type !== "draft.updated") throw new Error(event.type)
    expectTypeOf(event.data.draft).toEqualTypeOf<NoheadDraft<Post> | null>()
    expect(event.data.draft?.data.title).toBe("Hi")
    expect(event.data.record_id).toBe("rec_1")
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

  it("rejects a secret that isn't base64", async () => {
    const error = await unwrapWebhook(body, sign(body), {
      secret: "whsec_not base64!",
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WebhookVerificationError)
    expect((error as Error).message).toMatch("not base64")
  })

  it.each(["", "whsec_", undefined, null])(
    "rejects an empty or unset secret (%j)",
    async (empty) => {
      const error = await unwrapWebhook(body, sign(body), {
        secret: empty as string | undefined,
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(WebhookVerificationError)
      expect((error as Error).message).toBe("The webhook secret is empty")
    }
  )
})

// The official Standard Webhooks library signs every request above and
// below, and must agree with unwrap on the ones here.
describe("webhook verification against the official library", () => {
  const unicodeBody = JSON.stringify({
    ...JSON.parse(body),
    data: {
      record: { id: "rec_1", data: { title: "Rettet på forsiden ✓ 🎉" } },
    },
  })

  it.each([
    ["an event", body],
    ["an event with non-ASCII text", unicodeBody],
    ["the spec's example body", '{"test": 2432232314}'],
  ])("accepts %s it signs", async (_, payload) => {
    const headers = sign(payload)
    const expected = official.verify(payload, headers)
    const bytes = new TextEncoder().encode(payload)
    for (const input of [payload, bytes, bytes.buffer]) {
      await expect(unwrapWebhook(input, headers, { secret })).resolves.toEqual(
        expected
      )
      await expect(
        unwrapWebhook(input, new Headers(headers), { secret })
      ).resolves.toEqual(expected)
    }
  })

  it("accepts either secret's signature while a rotation overlaps", async () => {
    const old = sign(body, { signingSecret: otherSecret })
    const headers = {
      ...old,
      "webhook-signature": `${old["webhook-signature"]} ${sign(body)["webhook-signature"]}`,
    }
    for (const key of [secret, otherSecret]) {
      expect(new Webhook(key).verify(body, headers)).toMatchObject({
        id: "wev_1",
      })
      await expect(
        unwrapWebhook(body, headers, { secret: key })
      ).resolves.toMatchObject({ id: "wev_1" })
    }
  })

  const without = (name: string) => {
    const headers = sign(body)
    delete headers[name]
    return headers
  }

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
        headers["webhook-signature"] = headers["webhook-signature"]!.replace(
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
    ["no headers", () => [body, {}] as const],
    ["no webhook-id", () => [body, without("webhook-id")] as const],
    [
      "no webhook-timestamp",
      () => [body, without("webhook-timestamp")] as const,
    ],
    [
      "no webhook-signature",
      () => [body, without("webhook-signature")] as const,
    ],
    [
      "a non-ASCII webhook-signature",
      () => [body, { ...sign(body), "webhook-signature": "v1,ü✓🎉" }] as const,
    ],
    [
      "a non-ASCII webhook-id",
      () => [body, { ...sign(body), "webhook-id": "msg_ü✓🎉" }] as const,
    ],
    [
      "a non-ASCII webhook-timestamp",
      () => [body, { ...sign(body), "webhook-timestamp": "🎉" }] as const,
    ],
  ])("rejects %s, as the official library does", async (_, input) => {
    const [payload, headers] = input()
    expect(() => official.verify(payload, headers)).toThrow(
      StandardVerificationError
    )
    await expect(
      unwrapWebhook(payload, headers, { secret })
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it("rejects a body that isn't JSON, where the library throws a SyntaxError", async () => {
    const headers = sign("not json")
    expect(() => official.verify("not json", headers)).toThrow(SyntaxError)
    await expect(
      unwrapWebhook("not json", headers, { secret })
    ).rejects.toBeInstanceOf(WebhookVerificationError)
  })

  it("rejects Latin-1 header values that a Headers object accepts", async () => {
    const headers = sign(body)
    for (const [name, value] of [
      ["webhook-signature", "v1,ÿü"],
      ["webhook-id", "msg_ü"],
      ["webhook-timestamp", "ü"],
    ] as const) {
      await expect(
        unwrapWebhook(body, new Headers({ ...headers, [name]: value }), {
          secret,
        })
      ).rejects.toBeInstanceOf(WebhookVerificationError)
    }
  })
})
