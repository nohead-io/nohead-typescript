import type { APIPromise, PagePromise } from "../api-promise.ts"
import type { ConditionalRequestOptions, RequestOptions } from "../core.ts"
import type { Draft, RecordData } from "../generated/types.gen.ts"
import type {
  DraftCreateParams,
  DraftGetParams,
  DraftListParams,
  DraftUpdateParams,
  NoheadRecord,
} from "../types.ts"
import { Resource } from "./resource.ts"

/**
 * Drafts: changes to a record's content that wait until they are merged into
 * it, now or at a set time, while the record keeps its current content. A
 * record has at most one. `draft` is a draft ID (`drf_…`); `record` a record
 * ID; `collection` a collection ID or slug.
 */
export class Drafts extends Resource {
  /**
   * Starts the record's draft. A second is a `ConflictError` (detail code
   * `draft_exists`, with its `draft_id`): update that one instead.
   */
  create<D = RecordData>(
    record: string,
    params: DraftCreateParams<D>,
    options?: RequestOptions
  ): APIPromise<Draft> {
    return this.core.request(
      "drafts_create",
      { path: { record_id: record }, body: params },
      options
    )
  }

  /**
   * A collection's drafts, most recently changed first. `record_id` narrows
   * them to one record, or to several (1 to 100; an empty list is a
   * `TypeError`, since it would match no record).
   */
  list(
    collection: string,
    { record_id, ...params }: DraftListParams = {},
    options?: RequestOptions
  ): PagePromise<Draft> {
    if (Array.isArray(record_id) && record_id.length === 0)
      throw new TypeError("record_id needs at least one record ID")
    const filter =
      record_id === undefined
        ? undefined
        : {
            record_id: Array.isArray(record_id)
              ? { in: record_id.join(",") }
              : record_id,
          }
    return this.core.paginate(
      "drafts_list",
      {
        path: { collection_id: collection },
        query: { ...params, ...(filter && { filter }) },
      },
      options
    )
  }

  /** With `data` as the record reads after the merge, for previews. */
  get(
    draft: string,
    params: DraftGetParams = {},
    options?: RequestOptions
  ): APIPromise<Draft> {
    return this.core.request(
      "drafts_get",
      { path: { draft_id: draft }, query: params },
      options
    )
  }

  /** Sets the given fields (`null` clears one), as a record update does. */
  update<D = RecordData>(
    draft: string,
    params: DraftUpdateParams<D>,
    options?: ConditionalRequestOptions
  ): APIPromise<Draft> {
    return this.core.request(
      "drafts_update",
      { path: { draft_id: draft }, body: params },
      options
    )
  }

  /** Deletes the draft for good; returns it as it was. */
  discard(
    draft: string,
    options?: ConditionalRequestOptions
  ): APIPromise<Draft> {
    return this.core.request(
      "drafts_discard",
      { path: { draft_id: draft } },
      options
    )
  }

  /**
   * Applies the draft to its record now, as one `merge` revision, and
   * returns the record. Content only: the record stays live or not.
   */
  merge<D = RecordData>(
    draft: string,
    options?: ConditionalRequestOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "drafts_merge",
      { path: { draft_id: draft } },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  /** Merges the draft at `merge_at`, a future time; returns the draft. */
  schedule(
    draft: string,
    params: { merge_at: string | Date },
    options?: RequestOptions
  ): APIPromise<Draft> {
    return this.core.request(
      "drafts_schedule",
      { path: { draft_id: draft }, body: params },
      options
    )
  }

  unschedule(draft: string, options?: RequestOptions): APIPromise<Draft> {
    return this.core.request(
      "drafts_unschedule",
      { path: { draft_id: draft } },
      options
    )
  }
}
