// Verifying webhook requests (Standard Webhooks), without a client:
//
//   import { unwrapWebhook } from "@nohead/sdk/webhooks"
import { WebhookVerificationError } from "./errors.ts"
import type {
  Asset,
  Collection,
  SchemaChange,
  Webhook,
} from "./generated/types.gen.ts"
import type { NoheadRecord, RecordData } from "./types.ts"

interface EventBase<Type extends string, Data> {
  id: string
  object: "event"
  type: Type
  created_at: string
  project_id: string
  data: Data
}

export type RecordEvent<D = RecordData> = EventBase<
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "record.published"
  | "record.unpublished",
  { record: NoheadRecord<D>; revision: number; revision_id: string }
>
export type AssetEvent = EventBase<
  "asset.created" | "asset.deleted",
  { asset: Asset }
>
export type SchemaChangedEvent = EventBase<
  "schema.changed",
  { collection: Collection; schema_change: SchemaChange }
>
/** Sent by `webhooks.test`. */
export type WebhookTestEvent = EventBase<"webhook.test", { webhook: Webhook }>

/** A webhook request's body, narrowed by `type`. */
export type WebhookEvent<D = RecordData> =
  RecordEvent<D> | AssetEvent | SchemaChangedEvent | WebhookTestEvent

/** Request headers: a `Headers` object or a plain object (e.g. Node's). */
export type WebhookHeaders =
  Headers | Record<string, string | string[] | undefined>

export interface UnwrapOptions {
  /** The webhook's signing secret (`whsec_…`). */
  secret: string
  /** Seconds a timestamp may be off from now. Default 300. */
  tolerance?: number
}

/**
 * Checks a webhook request's signature and timestamp and returns its event.
 * Pass the raw body exactly as received: parsing and re-serializing JSON
 * changes the bytes, and the signature with them. Throws
 * `WebhookVerificationError` when anything does not match.
 *
 *   const event = await unwrapWebhook(await request.text(), request.headers, { secret })
 *   if (event.type === "record.published") { … }
 */
export async function unwrapWebhook<D = RecordData>(
  body: string | ArrayBuffer | Uint8Array,
  headers: WebhookHeaders,
  { secret, tolerance = 300 }: UnwrapOptions
): Promise<WebhookEvent<D>> {
  const id = header(headers, "webhook-id")
  const timestamp = header(headers, "webhook-timestamp")
  const signatures = header(headers, "webhook-signature")
  if (!id || !timestamp || !signatures) {
    throw new WebhookVerificationError(
      "Missing webhook-id, webhook-timestamp or webhook-signature header"
    )
  }
  const sentAt = Number(timestamp)
  if (
    !Number.isInteger(sentAt) ||
    Math.abs(Date.now() / 1000 - sentAt) > tolerance
  ) {
    throw new WebhookVerificationError(
      "The webhook timestamp is too far from the current time"
    )
  }

  const text = typeof body === "string" ? body : new TextDecoder().decode(body)
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase64(secret.replace(/^whsec_/, ""), "secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  )
  const signed = new TextEncoder().encode(`${id}.${timestamp}.${text}`)
  for (const entry of signatures.split(" ")) {
    const [version, signature] = entry.split(",", 2)
    if (version !== "v1" || !signature) continue
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = decodeBase64(signature, "signature")
    } catch {
      continue
    }
    // Constant-time comparison: the platform verifies the HMAC.
    if (await crypto.subtle.verify("HMAC", key, bytes, signed)) {
      try {
        return JSON.parse(text) as WebhookEvent<D>
      } catch {
        throw new WebhookVerificationError("The webhook body is not JSON")
      }
    }
  }
  throw new WebhookVerificationError("No webhook signature matches")
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name
  )?.[1]
  return Array.isArray(entry) ? entry.join(" ") : entry
}

function decodeBase64(value: string, what: string): Uint8Array<ArrayBuffer> {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new WebhookVerificationError(`The webhook ${what} is not base64`)
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
