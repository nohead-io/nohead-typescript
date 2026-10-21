// Public types: the API's schemas (generated from the contract) and the
// parameters of the SDK's methods.
import type * as G from "./generated/types.gen.ts"

export type * from "./generated/schemas.gen.ts"

/**
 * A record whose `data` has the shape `D`. Exported as `Nohead.Record` and
 * `NoheadRecord`, so it never shadows TypeScript's own `Record<K, V>`.
 *
 *   interface Post { title: string; author: string }
 *   const post = await nohead.records.get<Post>(id)   // post.data.title
 */
export type NoheadRecord<D = G.RecordData> = Omit<G.Record, "data"> & {
  data: D
}

/**
 * A draft whose `data` (the record's values as they read after the merge)
 * has the shape `D`, as on `NoheadRecord<D>`. Also `Nohead.Draft`.
 */
export type NoheadDraft<D = G.RecordData> = Omit<G.Draft, "data"> & {
  data: D
}

/** Field values to write: `null` clears a field. */
export type RecordDataUpdate<D> = { [K in keyof D]?: D[K] | null }

export type FilterValue = string | number | boolean | Date

/**
 * Operators for one key. `ne` matches records without a value; on fields
 * with several values `eq`, `ne` and `in` mean contains, does not contain and
 * contains any of. Ranges take numbers and dates (`"today"`, `"now"`, or a
 * day, which covers that day in the field's time zone).
 */
export interface FilterOperators<V = FilterValue> {
  eq?: V
  ne?: V
  gt?: V
  gte?: V
  lt?: V
  lte?: V
  /** Any of these (up to 100). */
  in?: V[]
  /** Has a value (`true`) or has none (`false`). */
  exists?: boolean
}

/**
 * Filters, combined with AND: a value to equal, or operators, e.g.
 * `{ published_at: { exists: true }, price: { lt: 50 }, category: { in: ["shoes", "bags"] } }`.
 * `published_at: { exists }` says whether records are published; record
 * lists and counts also filter `created_at`, `updated_at` and `published_at`
 * by range. `deleted: true` lists deleted records instead.
 */
export interface RecordFilter {
  published_at?: FilterOperators<string | Date>
  deleted?: boolean
  [apiKey: string]: FilterValue | FilterOperators | undefined
}

export type RecordSort = NonNullable<
  NonNullable<G.RecordsListData["query"]>["sort"]
>

export interface ListParams {
  /** Page size, 1 to 100 (default 20). */
  limit?: number
  /** Start from a page's `meta.next_cursor`. */
  cursor?: string
}

export interface RecordListParams extends ListParams {
  filter?: RecordFilter
  sort?: RecordSort
  /** Relation or asset fields to embed under `expanded` (at most 5). */
  expand?: string[]
}

/** A deleted record is returned too, with `deleted_at` and `purge_after`. */
export interface RecordGetParams {
  expand?: string[]
}

export interface RecordCreateParams<D = G.RecordData> {
  data: D
  /**
   * The key of a `unique` field whose value `data` includes: the active
   * record holding that value is updated instead, if there is one.
   */
  upsert_on?: string
}

export interface RecordUpdateParams<D = G.RecordData> {
  data: RecordDataUpdate<D>
}

/** `data` over the record's values, or with `from_revision`, an earlier revision's. */
export interface DraftCreateParams<D = G.RecordData> {
  data?: RecordDataUpdate<D>
  from_revision?: number
}

export interface DraftUpdateParams<D = G.RecordData> {
  data: RecordDataUpdate<D>
}

export interface DraftGetParams {
  /** Relation or asset fields to embed under `expanded` (at most 5). */
  expand?: string[]
}

export interface DraftListParams extends ListParams {
  sort?: "updated_at" | "-updated_at"
}

export interface DraftScheduleParams {
  /** When to merge the draft: a future time. */
  merge_at: string | Date
}

export interface RecordCountParams {
  filter?: RecordFilter
}

/** The whole schedule: a time left out is cleared, as `null` is. */
export interface RecordScheduleParams {
  /** A future time, or `null` for none. */
  publish_at?: string | Date | null
  unpublish_at?: string | Date | null
}

export interface ScheduledChangeListParams extends ListParams {
  /** Soonest first by default (`at`). */
  sort?: "at" | "-at"
}

export type RecordBulkParams = G.RecordBatchRequest

export type RecordDiffParams = NonNullable<G.RecordsDiffData["query"]>

export interface RecordSearchParams extends ListParams {
  /** Needs `filterable` fields (`published_at: { exists }` always works). */
  filter?: RecordFilter
  /** Needs a `sortable` field, e.g. `-published_at`; relevance otherwise. */
  sort?: string
  expand?: string[]
}

export interface ProjectSearchParams extends ListParams {
  /** Collection slugs or IDs to search in; every searchable one otherwise. */
  collections?: string[]
  /** `{ published_at: { exists: true } }`: published records only (or unpublished, `false`). */
  filter?: { published_at?: { exists: boolean } }
}

/** A time range, e.g. `{ gte: "2026-10-01T00:00:00Z", lt: new Date() }`. */
export interface TimeRange {
  gte?: string | Date
  gt?: string | Date
  lte?: string | Date
  lt?: string | Date
}

/** Filters of a record's revisions, combined with AND. */
export interface RevisionFilter {
  operation?: G.RecordRevisionOperation
  /** A user (`usr_…`) or API key (`key_…`). */
  actor_id?: string
  created_at?: TimeRange
}

export interface RevisionListParams extends ListParams {
  filter?: RevisionFilter
}

export interface DryRunParams {
  /** Preview the change without making it. */
  dry_run?: boolean
}

export interface DeletedListParams extends ListParams {
  /** List deleted items instead (they can be restored until `purge_after`). */
  deleted?: boolean
}

export interface AssetListParams extends DeletedListParams {
  /**
   * Only assets of a MIME type or `type/*` wildcard (`"image/*"`), or of any
   * of several: `["image/*", "application/pdf"]`, such as an asset
   * field's `accepted_types`.
   */
  content_type?: string | string[]
}

export interface SchemaParams {
  /** A past schema version; the current one otherwise. */
  version?: number
}

/** `field_id`, one of the collection's fields, and the parts of its definition to change. */
export type MigrationCreateParams = G.FieldMigrationRequest

export interface FieldReorderParams {
  /** Every active field of the collection, once each, in the new order. */
  field_ids: string[]
}

export type ImageUrlParams = NonNullable<G.AssetsImageUrlData["query"]>

export interface DeliveryListParams extends ListParams {
  status?: "pending" | "succeeded" | "failed"
}

/** Filters of the activity log, combined with AND. */
export interface AuditEventFilter {
  /** An event type, or a prefix with a trailing `.*` (`record.*`). */
  type?: string
  /** What events are about (`record`, `field`…): one type, or any of several. */
  resource_type?: string | string[]
  resource_id?: string
  actor_type?: "user" | "api_key" | "system"
  /** A user (`usr_…`) or API key (`key_…`). */
  actor_id?: string
  created_at?: TimeRange
}

export interface AuditEventListParams extends ListParams {
  filter?: AuditEventFilter
  /** Newest first by default (`-created_at`). */
  sort?: "created_at" | "-created_at"
}

/** The metadata of a search page: also an estimate of the total hits. */
export type SearchMeta = G.SearchResults["meta"]
