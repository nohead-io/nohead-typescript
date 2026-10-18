import type { APIPromise, PagePromise } from "../api-promise.ts"
import type {
  ConditionalRequestOptions,
  ConditionalWriteOptions,
  RequestOptions,
} from "../core.ts"
import type { RecordData } from "../generated/types.gen.ts"
import type {
  DraftCreateParams,
  DraftGetParams,
  DraftListParams,
  DraftScheduleParams,
  DraftUpdateParams,
  NoheadDraft,
  NoheadRecord,
} from "../types.ts"
import { Resource } from "./resource.ts"

/**
 * Drafts: changes to a record's content that wait until they are merged into
 * it, now or at a set time, while the record keeps its current content. A
 * record has at most one. `draft` is a draft ID (`drf_…`); `record` a record
 * ID; `collection` a collection ID or slug. Like records, drafts take the
 * type of their data: `drafts.get<Post>(id)`.
 */
export class Drafts extends Resource {
  /**
   * Starts the record's draft, from the record's values (`data` over them),
   * or from an earlier revision's (`from_revision`). A second is a
   * `ConflictError` (detail code `draft_exists`, with its `draft_id`): update
   * that one instead.
   */
  create<D = RecordData>(
    record: string,
    params: DraftCreateParams<D> = {},
    options?: RequestOptions
  ): APIPromise<NoheadDraft<D>> {
    return this.core.request(
      "drafts_create",
      { path: { record_id: record }, body: params },
      options
    ) as APIPromise<NoheadDraft<D>>
  }

  /**
   * A collection's drafts, most recently changed first. `record_id` narrows
   * them to one record, or to several (1 to 100; an empty list is a
   * `TypeError`, since it would match no record).
   */
  list<D = RecordData>(
    collection: string,
    { record_id, ...params }: DraftListParams = {},
    options?: RequestOptions
  ): PagePromise<NoheadDraft<D>> {
    if (Array.isArray(record_id) && record_id.length === 0)
      throw new TypeError("record_id needs at least one record ID")
    const filter =
      record_id === undefined
        ? undefined
        : {
            record_id: Array.isArray(record_id) ? { in: record_id } : record_id,
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
  get<D = RecordData>(
    draft: string,
    params: DraftGetParams = {},
    options?: RequestOptions
  ): APIPromise<NoheadDraft<D>> {
    return this.core.request(
      "drafts_get",
      { path: { draft_id: draft }, query: params },
      options
    ) as APIPromise<NoheadDraft<D>>
  }

  /** Sets the given fields (`null` clears one), as a record update does. */
  update<D = RecordData>(
    draft: string,
    params: DraftUpdateParams<D>,
    options?: ConditionalRequestOptions
  ): APIPromise<NoheadDraft<D>> {
    return this.core.request(
      "drafts_update",
      { path: { draft_id: draft }, body: params },
      options
    ) as APIPromise<NoheadDraft<D>>
  }

  /** Deletes the draft for good; returns it as it was. */
  discard<D = RecordData>(
    draft: string,
    options?: ConditionalRequestOptions
  ): APIPromise<NoheadDraft<D>> {
    return this.core.request(
      "drafts_discard",
      { path: { draft_id: draft } },
      options
    ) as APIPromise<NoheadDraft<D>>
  }

  /**
   * Applies the draft to its record now, as one `merge` revision, and
   * returns the record. Content only: the record stays live or not.
   */
  merge<D = RecordData>(
    draft: string,
    options?: ConditionalWriteOptions
  ): APIPromise<NoheadRecord<D>> {
    return this.core.request(
      "drafts_merge",
      { path: { draft_id: draft } },
      options
    ) as APIPromise<NoheadRecord<D>>
  }

  /** Merges the draft at `merge_at`, a future time; returns the draft. */
  schedule<D = RecordData>(
    draft: string,
    params: DraftScheduleParams,
    options?: RequestOptions
  ): APIPromise<NoheadDraft<D>> {
    return this.core.request(
      "drafts_schedule",
      { path: { draft_id: draft }, body: params },
      options
    ) as APIPromise<NoheadDraft<D>>
  }

  unschedule<D = RecordData>(
    draft: string,
    options?: RequestOptions
  ): APIPromise<NoheadDraft<D>> {
    return this.core.request(
      "drafts_unschedule",
      { path: { draft_id: draft } },
      options
    ) as APIPromise<NoheadDraft<D>>
  }
}
