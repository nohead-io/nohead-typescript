// Verifying webhook requests (Standard Webhooks), without a client:
//
//   import { unwrapWebhook } from "@nohead/sdk/webhooks"
import { WebhookVerificationError } from "./errors.ts"
import type * as G from "./generated/types.gen.ts"
import type { NoheadDraft, NoheadRecord, RecordData } from "./types.ts"

interface EventBase<Type extends string, Data> {
  id: string
  object: "event"
  type: Type
  created_at: string
  project_id: string
  /** Who made the change. An integration that writes back can skip its own. */
  actor: G.Actor
  /** The client the change came through, when known. */
  via: G.Via | null
  data: Data
}

/** The event types that start with `prefix`. */
type TypesOf<Prefix extends string> = Extract<
  G.WebhookEventType,
  `${Prefix}.${string}`
>

/**
 * A change to a record. `record` is the record as the change's revision left
 * it, or as it is now for events without a revision (`record.scheduled`,
 * `record.unscheduled`, `record.schedule_failed`, `record.redacted`); `null`
 * once the record is purged.
 */
export type RecordEvent<D = RecordData> = EventBase<
  TypesOf<"record">,
  Omit<G.RecordEventData, "record"> & { record: NoheadRecord<D> | null }
>
/**
 * A change to a draft. `draft` is the draft as it is now; `null` once merged
 * or discarded, and while its record is deleted.
 */
export type DraftEvent<D = RecordData> = EventBase<
  TypesOf<"draft">,
  Omit<G.DraftEventData, "draft"> & { draft: NoheadDraft<D> | null }
>
/** An asset as it is now; only its `id` and `object` once it is purged. */
export type AssetEvent = EventBase<TypesOf<"asset">, G.AssetEventData>
/**
 * A schema change: the collection as it left it, and the change; a field's
 * events also name the field (`field_id`).
 */
export type SchemaEvent = EventBase<
  Exclude<TypesOf<"collection" | "field">, "field.alias_removed">,
  G.SchemaEventData
>
/** A renamed field's old API key stopped answering before it expired. */
export type FieldAliasRemovedEvent = EventBase<
  "field.alias_removed",
  G.FieldAliasEventData
>
/** Sent by `webhooks.test`. */
export type WebhookTestEvent = EventBase<"webhook.test", G.WebhookTestEventData>

/** A webhook request's body, narrowed by `type`. */
export type WebhookEvent<D = RecordData> =
  | RecordEvent<D>
  | DraftEvent<D>
  | AssetEvent
  | SchemaEvent
  | FieldAliasRemovedEvent
  | WebhookTestEvent

/** Request headers: a `Headers` object or a plain object (e.g. Node's). */
export type WebhookHeaders =
  Headers | Record<string, string | string[] | undefined>

export interface UnwrapOptions {
  /**
   * The webhook's signing secret (`whsec_…`). While a rotation overlaps,
   * requests carry a signature for each secret, so either one verifies.
   */
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
  const keyBytes = decodeBase64(secret.replace(/^whsec_/, ""), "secret")
  if (keyBytes.length === 0) {
    throw new WebhookVerificationError("The webhook secret is empty")
  }
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
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
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}
