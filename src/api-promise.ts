import { NoheadError } from "./errors.ts"
import type { ListMeta } from "./generated/types.gen.ts"

/** A response's data with the raw `Response`, from `withResponse()`. */
export interface APIResponse<T> {
  data: T
  response: Response
  /** The `X-Request-Id` header (`req_…`). */
  requestId: string | undefined
}

/**
 * What every method returns: a promise of the resource, which also offers
 * `withResponse()` for the raw response (headers, status) alongside it.
 *
 *   const record = await nohead.records.get(id)
 *   const { data, response } = await nohead.records.get(id).withResponse()
 */
export class APIPromise<T> implements PromiseLike<T> {
  readonly #raw: Promise<APIResponse<T>>

  constructor(raw: Promise<APIResponse<T>>) {
    this.#raw = raw
  }

  /** The data together with the `Response` it came from. */
  withResponse(): Promise<APIResponse<T>> {
    return this.#raw
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.#raw.then((r) => r.data).then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ): Promise<T | TResult> {
    return this.then(undefined, onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then().finally(onfinally)
  }

  get [Symbol.toStringTag]() {
    return "APIPromise"
  }
}

/** One page of a list, iterable across the pages that follow it. */
export class Page<
  T,
  Meta extends ListMeta = ListMeta,
> implements AsyncIterable<T> {
  /** The items on this page. */
  readonly data: T[]
  /** `next_cursor` and `has_more` (and `total_estimate` for search). */
  readonly meta: Meta
  readonly #fetch: (cursor: string) => Promise<Page<T, Meta>>

  constructor(
    data: T[],
    meta: Meta,
    fetch: (cursor: string) => Promise<Page<T, Meta>>
  ) {
    this.data = data
    this.meta = meta
    this.#fetch = fetch
  }

  hasNextPage(): boolean {
    return this.meta.has_more && this.meta.next_cursor !== null
  }

  /** The next page; throws when there is none (check `hasNextPage()`). */
  getNextPage(): Promise<Page<T, Meta>> {
    if (!this.hasNextPage()) {
      return Promise.reject(new NoheadError("There is no next page"))
    }
    return this.#fetch(this.meta.next_cursor!)
  }

  /** Every item from this page on, fetching later pages as needed. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    yield* this.data
    let next = this.hasNextPage() ? await this.getNextPage() : undefined
    while (next) {
      yield* next.data
      next = next.hasNextPage() ? await next.getNextPage() : undefined
    }
  }
}

/**
 * What list methods return. Awaiting it gives the first page; iterating it
 * walks every item across pages.
 *
 *   const page = await nohead.records.list("posts")
 *   for await (const record of nohead.records.list("posts")) { … }
 */
export class PagePromise<T, Meta extends ListMeta = ListMeta>
  extends APIPromise<Page<T, Meta>>
  implements AsyncIterable<T>
{
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    yield* await this
  }

  override get [Symbol.toStringTag]() {
    return "PagePromise"
  }
}
