import type { APIPromise, PagePromise } from "../api-promise.ts"
import type { RequestOptions } from "../core.ts"
import type {
  Webhook,
  WebhookCreate,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookUpdate,
  WebhookWithSecret,
} from "../generated/types.gen.ts"
import type { DeliveryListParams, ListParams, RecordData } from "../types.ts"
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

  list(
    params: ListParams = {},
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

  delete(webhook: string, options?: RequestOptions): APIPromise<Webhook> {
    return this.core.request(
      "webhooks_delete",
      { path: { webhook_id: webhook } },
      options
    )
  }

  /** A new signing secret; the old one stops working at once. */
  rotateSecret(
    webhook: string,
    options?: RequestOptions
  ): APIPromise<WebhookWithSecret> {
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

  /** Sends the event again. */
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
