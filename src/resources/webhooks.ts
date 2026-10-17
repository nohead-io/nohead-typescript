import type { APIPromise, PagePromise } from "../api-promise.ts"
import type { RequestOptions } from "../core.ts"
import type {
  Webhook,
  WebhookCreate,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookSecret,
  WebhookSecretWithValue,
  WebhookUpdate,
  WebhookWithSecret,
} from "../generated/types.gen.ts"
import type {
  DeletedListParams,
  DeliveryListParams,
  ListParams,
  RecordData,
} from "../types.ts"
import {
  unwrapWebhook,
  type UnwrapOptions,
  type WebhookEvent,
  type WebhookHeaders,
} from "../webhooks.ts"
import { Resource } from "./resource.ts"

/** Webhooks of the key's project. `webhook` is a webhook ID (`wh_…`). */
export class Webhooks extends Resource {
  readonly deliveries = new Deliveries(this.core)
  readonly secrets = new Secrets(this.core)

  list(
    params: DeletedListParams = {},
    options?: RequestOptions
  ): PagePromise<Webhook> {
    return this.core.paginate("webhooks_list", { query: params }, options)
  }

  get(webhook: string, options?: RequestOptions): APIPromise<Webhook> {
    return this.core.request(
      "webhooks_get",
      { path: { webhook_id: webhook } },
      options
    )
  }

  /** Subscribes a URL. The response is the only time `secret` is shown. */
  create(
    params: WebhookCreate,
    options?: RequestOptions
  ): APIPromise<WebhookWithSecret> {
    return this.core.request("webhooks_create", { body: params }, options)
  }

  update(
    webhook: string,
    params: WebhookUpdate,
    options?: RequestOptions
  ): APIPromise<Webhook> {
    return this.core.request(
      "webhooks_update",
      { path: { webhook_id: webhook }, body: params },
      options
    )
  }

  /** Soft-deletes the webhook: `restore` brings it back until its `purge_after`. */
  delete(webhook: string, options?: RequestOptions): APIPromise<Webhook> {
    return this.core.request(
      "webhooks_delete",
      { path: { webhook_id: webhook } },
      options
    )
  }

  restore(webhook: string, options?: RequestOptions): APIPromise<Webhook> {
    return this.core.request(
      "webhooks_restore",
      { path: { webhook_id: webhook } },
      options
    )
  }

  /**
   * A new signing secret (`secret`, shown only here). The ones before it
   * keep signing for 24 hours, so receivers can switch without rejecting
   * deliveries; `secrets.retire` ends one sooner.
   */
  rotateSecret(
    webhook: string,
    options?: RequestOptions
  ): APIPromise<WebhookSecretWithValue> {
    return this.core.request(
      "webhooks_rotate_secret",
      { path: { webhook_id: webhook } },
      options
    )
  }

  /** Sends a `webhook.test` event to the URL. */
  test(webhook: string, options?: RequestOptions): APIPromise<WebhookDelivery> {
    return this.core.request(
      "webhooks_test",
      { path: { webhook_id: webhook } },
      options
    )
  }

  /**
   * Checks a webhook request's signature and returns its event (see
   * `unwrapWebhook` in `@nohead/sdk/webhooks`, which needs no client).
   */
  unwrap<D = RecordData>(
    body: string | ArrayBuffer | Uint8Array,
    headers: WebhookHeaders,
    options: UnwrapOptions
  ): Promise<WebhookEvent<D>> {
    return unwrapWebhook<D>(body, headers, options)
  }
}

/** Delivery attempts of a webhook's events. */
export class Deliveries extends Resource {
  list(
    webhook: string,
    params: DeliveryListParams = {},
    options?: RequestOptions
  ): PagePromise<WebhookDelivery> {
    return this.core.paginate(
      "webhook_deliveries_list",
      { path: { webhook_id: webhook }, query: params },
      options
    )
  }

  get(
    delivery: string,
    options?: RequestOptions
  ): APIPromise<WebhookDeliveryDetail> {
    return this.core.request(
      "webhook_deliveries_get",
      { path: { delivery_id: delivery } },
      options
    )
  }

  /** Sends the event again now, as a new attempt. */
  retry(
    delivery: string,
    options?: RequestOptions
  ): APIPromise<WebhookDelivery> {
    return this.core.request(
      "webhook_deliveries_retry",
      { path: { delivery_id: delivery } },
      options
    )
  }
}

/** A webhook's signing secrets. `secret` is a secret ID (`whs_…`). */
export class Secrets extends Resource {
  /** Those signing deliveries now, oldest first, without their values. */
  list(
    webhook: string,
    params: ListParams = {},
    options?: RequestOptions
  ): PagePromise<WebhookSecret> {
    return this.core.paginate(
      "webhook_secrets_list",
      { path: { webhook_id: webhook }, query: params },
      options
    )
  }

  /** Stops signing with it now. The newest can't be retired: rotate first. */
  retire(secret: string, options?: RequestOptions): APIPromise<WebhookSecret> {
    return this.core.request(
      "webhook_secrets_retire",
      { path: { secret_id: secret } },
      options
    )
  }
}
