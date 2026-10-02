import type { APIPromise, PagePromise } from "../api-promise.ts"
import type { ConditionalRequestOptions, RequestOptions } from "../core.ts"
import type {
  RecordData,
  RecordDiff,
  RecordRevision,
  RecordRevisionDetail,
  RevertPreview,
  BulkRecordsResult,
  RecordCount,
} from "../generated/types.gen.ts"
import type {
  DryRunParams,
  NoheadRecord,
  RecordBulkParams,
  RecordCountParams,
  RecordCreateParams,
  RecordDiffParams,
  RecordGetParams,
  RecordListParams,
  RecordScheduleParams,
  RecordSearchParams,
  RecordUpdateParams,
  RevisionListParams,
  SearchMeta,
} from "../types.ts"
import { Resource } from "./resource.ts"

/**
 * Records: the content of a collection. `collection` is a collection ID or
 * slug; `record` a record ID (`rec_…`).
 */
export class Records extends Resource {
  readonly revisions = new Revisions(this.core)

  /** A collection's records, newest first by default. */
  list<D = RecordData>(
    collection: string,
    params: RecordListParams = {},
    options?: RequestOptions
  ): PagePromise<NoheadRecord<D>> {
    return this.core.paginate(
      "records_list",
      { path: { collection_id: collection }, query: params },
      options
    )
  }

  get<D = RecordData>(
    record: string,
    params: RecordGetParams = {},
    options?: RequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_get",
      { path: { record_id: record }, query: params },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  /** Creates a draft. */
  create<D = RecordData>(
    collection: string,
    params: RecordCreateParams<D>,
    options?: RequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_create",
      { path: { collection_id: collection }, body: params },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  /** Sets the given fields (`null` clears one); others keep their values. */
  update<D = RecordData>(
    record: string,
    params: RecordUpdateParams<D>,
    options?: ConditionalRequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_update",
      { path: { record_id: record }, body: params },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  /** Soft-deletes the record: `restore` brings it back within 30 days. */
  delete<D = RecordData>(
    record: string,
    options?: ConditionalRequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_delete",
      { path: { record_id: record } },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  restore<D = RecordData>(
    record: string,
    options?: RequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_restore",
      { path: { record_id: record } },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  publish<D = RecordData>(
    record: string,
    options?: ConditionalRequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_publish",
      { path: { record_id: record } },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  unpublish<D = RecordData>(
    record: string,
    options?: ConditionalRequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_unpublish",
      { path: { record_id: record } },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  /** Publishes and/or unpublishes the record later. */
  schedule<D = RecordData>(
    record: string,
    params: RecordScheduleParams,
    options?: RequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_schedule",
      { path: { record_id: record }, body: params },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  /** Clears both scheduled times. */
  unschedule<D = RecordData>(
    record: string,
    options?: RequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "records_unschedule",
      { path: { record_id: record } },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  count(
    collection: string,
    params: RecordCountParams = {},
    options?: RequestOptions
  ): APIPromise<RecordCount> {
    return this.core.request(
      "records_count",
      { path: { collection_id: collection }, query: params },
      options
    )
  }

  /**
   * Publishes, unpublishes, deletes, restores or updates up to 100 records.
   * Each record succeeds or fails on its own; see `results`.
   */
  bulk(
    collection: string,
    params: RecordBulkParams,
    options?: RequestOptions
  ): APIPromise<BulkRecordsResult> {
    return this.core.request(
      "records_bulk",
      { path: { collection_id: collection }, body: params },
      options
    )
  }

  /** The changes between two revisions. */
  diff(
    record: string,
    params: RecordDiffParams,
    options?: RequestOptions
  ): APIPromise<RecordDiff> {
    return this.core.request(
      "records_diff",
      { path: { record_id: record }, query: params },
      options
    )
  }

  /**
   * Full-text search in one collection (`search_enabled` collections).
   * Pages through the first 1,000 hits, most relevant first.
   */
  search<D = RecordData>(
    collection: string,
    query: string,
    params: RecordSearchParams = {},
    options?: RequestOptions
  ): PagePromise<NoheadRecord<D>, SearchMeta> {
    return this.core.paginate(
      "collections_search",
      { path: { collection_id: collection }, query: { q: query, ...params } },
      options
    )
  }
}

/** A record's version history. `revision` is a revision number. */
export class Revisions extends Resource {
  /** Newest first. */
  list(
    record: string,
    params: RevisionListParams = {},
    options?: RequestOptions
  ): PagePromise<RecordRevision> {
    return this.core.paginate(
      "record_revisions_list",
      { path: { record_id: record }, query: params },
      options
    )
  }

  get(
    record: string,
    revision: number,
    options?: RequestOptions
  ): APIPromise<RecordRevisionDetail> {
    return this.core.request(
      "record_revisions_get",
      { path: { record_id: record, revision } },
      options
    )
  }

  /** Restores the record's data as of `revision`, as a new revision. */
  revert(
    record: string,
    revision: number,
    params: { dry_run: true },
    options?: ConditionalRequestOptions
  ): APIPromise<RevertPreview>
  revert<D = RecordData>(
    record: string,
    revision: number,
    params?: DryRunParams,
    options?: ConditionalRequestOptions
  ): APIPromise<NoheadRecord<D>>
  revert(
    record: string,
    revision: number,
    params: DryRunParams = {},
    options?: ConditionalRequestOptions
  ): APIPromise<unknown> {
    return this.core.request(
      "record_revisions_revert",
      { path: { record_id: record, revision }, query: params },
      options
    )
  }
}
