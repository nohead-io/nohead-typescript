import { vi } from "vitest"

import { Nohead } from "../src/index.ts"
import type { ClientOptions } from "../src/index.ts"

export interface Call {
  method: string
  url: URL
  headers: Headers
  body: unknown
  signal?: AbortSignal
}

type Reply = Response | Error | ((call: Call) => Response | Promise<Response>)

/** JSON response helper. */
export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

export function apiError(
  status: number,
  type: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
): Response {
  return json(
    status,
    {
      error: {
        type,
        message: `${type} message`,
        request_id: "req_1",
        ...extra,
      },
    },
    headers
  )
}

/**
 * A client whose fetch answers from `replies` in order (the last one repeats)
 * and records every call.
 */
export function mockClient(
  replies: Reply[],
  options: ClientOptions = {}
): { nohead: Nohead; calls: Call[] } {
  const calls: Call[] = []
  let index = 0
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = init.body
    const call: Call = {
      method: init.method ?? "GET",
      url: new URL(String(input)),
      headers: new Headers(init.headers),
      body:
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw === undefined || raw === null
            ? undefined
            : raw,
      signal: init.signal ?? undefined,
    }
    calls.push(call)
    const reply = replies[Math.min(index++, replies.length - 1)]!
    if (reply instanceof Error) throw reply
    const response = typeof reply === "function" ? await reply(call) : reply
    return response.clone()
  }
  const nohead = new Nohead({
    apiKey: "sk_live_test",
    baseUrl: "https://api.test",
    projectId: "prj_1",
    fetch: fetch as typeof globalThis.fetch,
    ...options,
  })
  return { nohead, calls }
}

/**
 * What `promise` settles to, running fake timers (vi.useFakeTimers) until it
 * does, so the waits between attempts take no time. Real timers, such as
 * AbortSignal.timeout's, still fire: each run yields to the event loop.
 */
export async function settle<T>(promise: PromiseLike<T>): Promise<T> {
  let done = false
  const outcome = Promise.allSettled([promise]).finally(() => (done = true))
  while (!done) await vi.runAllTimersAsync()
  const [result] = await outcome
  if (result.status === "rejected") throw result.reason
  return result.value
}

export const record = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  object: "record",
  collection_id: "col_1",
  collection: "posts",
  status: "draft",
  published_at: null,
  schedule: { publish_at: null, unpublish_at: null },
  revision: 1,
  schema_version: 1,
  history_pruned_through: null,
  deleted: false,
  data,
  created_at: "2026-10-02T12:00:00.000Z",
  updated_at: "2026-10-02T12:00:00.000Z",
})

export const page = (items: unknown[], next: string | null) =>
  json(200, {
    data: items,
    meta: { next_cursor: next, has_more: next !== null },
  })
