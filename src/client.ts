import type { PagePromise } from "./api-promise.ts"
import { Core, type ClientOptions, type RequestOptions } from "./core.ts"
import type * as G from "./generated/types.gen.ts"
import { Assets } from "./resources/assets.ts"
import { AuditEvents, FeatureFlags, Health, Me } from "./resources/other.ts"
import { Records } from "./resources/records.ts"
import { Collections, Fields, Migrations } from "./resources/schema.ts"
import { Webhooks } from "./resources/webhooks.ts"
import type {
  NoheadRecord,
  ProjectSearchParams,
  RecordData,
  SearchMeta,
} from "./types.ts"

/**
 * A client for the Nohead API, authenticated with a project API key.
 *
 *   import { Nohead } from "@nohead/sdk"
 *
 *   const nohead = new Nohead()   // NOHEAD_API_KEY
 *   for await (const post of nohead.records.list("posts")) console.log(post.data.title)
 */
export class Nohead {
  readonly records: Records
  readonly collections: Collections
  readonly fields: Fields
  readonly migrations: Migrations
  readonly assets: Assets
  readonly webhooks: Webhooks
  readonly auditEvents: AuditEvents
  readonly featureFlags: FeatureFlags
  readonly me: Me
  readonly health: Health
  readonly #core: Core

  constructor(options: ClientOptions = {}) {
    const core = new Core(options)
    this.#core = core
    this.records = new Records(core)
    this.collections = new Collections(core)
    this.fields = new Fields(core)
    this.migrations = new Migrations(core)
    this.assets = new Assets(core)
    this.webhooks = new Webhooks(core)
    this.auditEvents = new AuditEvents(core)
    this.featureFlags = new FeatureFlags(core)
    this.me = new Me(core)
    this.health = new Health(core)
  }

  /**
   * Full-text search across the key's project (or some of its
   * collections), most relevant first, through the first 1,000 hits.
   */
  search<D = RecordData>(
    query: string,
    params: ProjectSearchParams = {},
    options?: RequestOptions
  ): PagePromise<NoheadRecord<D>, SearchMeta> {
    return this.#core.paginate(
      "projects_search",
      { query: { q: query, ...params } },
      options
    )
  }
}

/** The main types, also reachable as `Nohead.Record`, `Nohead.Collection`… */
// A type-only namespace merged with the class: `Nohead.Record` cannot be a
// module export without shadowing TypeScript's `Record<K, V>`.
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace Nohead {
  export type Record<D = RecordData> = NoheadRecord<D>
  export type Collection = G.Collection
  export type Field = G.Field
  export type Asset = G.Asset
  export type Webhook = G.Webhook
  export type Schema = G.Schema
  export type FieldMigration = G.FieldMigration
  export type RecordRevision = G.RecordRevision
}
