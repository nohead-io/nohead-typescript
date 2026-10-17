import type { Core } from "../core.ts"

export abstract class Resource {
  protected readonly core: Core

  constructor(core: Core) {
    this.core = core
  }
}

/**
 * A list's query: the options the API reads as filters (`deleted`,
 * `content_type`, `status`) go under `filter[...]`, the rest stay as they are.
 */
export function listQuery(
  params: object,
  filters: readonly string[]
): Record<string, unknown> {
  const query: Record<string, unknown> = { ...params }
  const filter: Record<string, unknown> = {}
  for (const name of filters) {
    if (query[name] !== undefined) filter[name] = query[name]
    delete query[name]
  }
  return Object.keys(filter).length > 0 ? { ...query, filter } : query
}
