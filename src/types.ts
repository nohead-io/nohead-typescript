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

/** Field values to write: `null` clears a field. */
export type RecordDataUpdate<D> = { [K in keyof D]?: D[K] | null }

export type FilterValue = string | number | boolean | Date

/**
 * Equality filters: `{ status: "published", author: "rec_…" }`. For fields
 * with several values a filter means "contains".
 */
export interface RecordFilter {
  status?: "draft" | "published"
  deleted?: boolean
  [apiKey: string]: FilterValue | undefined
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

export interface RecordGetParams {
  expand?: string[]
  include_deleted?: boolean
}

export interface RecordCreateParams<D = G.RecordData> {
  data: D
}

export interface RecordUpdateParams<D = G.RecordData> {
  data: RecordDataUpdate<D>
}

export interface RecordCountParams {
  filter?: RecordFilter
}

export interface RecordScheduleParams {
  /** A future time, or `null` for none. Omitted keys keep their value. */
  publish_at?: string | Date | null
  unpublish_at?: string | Date | null
}

export type RecordBulkParams = G.BulkRecordsRequest

export type RecordDiffParams = NonNullable<G.RecordsDiffData["query"]>

export interface RecordSearchParams extends ListParams {
  /** Needs `filterable` fields (status and timestamps always work). */
  filter?: RecordFilter
  /** Needs a `sortable` field, e.g. `-published_at`; relevance otherwise. */
  sort?: string
  expand?: string[]
}

export interface ProjectSearchParams extends ListParams {
  /** Collection slugs or IDs to search in; every searchable one otherwise. */
  collections?: string[]
  filter?: { status?: "draft" | "published" }
}

export interface RevisionListParams extends ListParams {
  filter?: NonNullable<G.RecordRevisionsListData["query"]>["filter"]
}

export interface DryRunParams {
  /** Preview the change without making it. */
  dry_run?: boolean
}

export interface DeletedListParams extends ListParams {
  /** List deleted items instead (they can be restored for 30 days). */
  deleted?: boolean
}

export interface SchemaParams {
  /** A past schema version; the current one otherwise. */
  version?: number
}

export type FieldMigrateParams = G.FieldMigrationRequest

export type ImageUrlParams = NonNullable<G.AssetsImageUrlData["query"]>

export interface DeliveryListParams extends ListParams {
  status?: "pending" | "succeeded" | "failed"
}

export interface AuditEventListParams extends ListParams {
  filter?: Omit<
    NonNullable<
      NonNullable<G.AuditEventsListForProjectData["query"]>["filter"]
    >,
    "project_id"
  >
  sort?: "id" | "-id"
}

/** The metadata of a search page: also an estimate of the total hits. */
export type SearchMeta = G.SearchResults["meta"]
