import { onTestFinished, vi } from "vitest"

import { Nohead } from "../src/index.ts"
import type { ClientOptions } from "../src/index.ts"
import {
  example,
  replyProblems,
  requestProblems,
  routeOf,
  routes,
} from "./spec.ts"

export interface Call {
  method: string
  url: URL
  headers: Headers
  body: unknown
  signal?: AbortSignal
  /** The request as fetch got it (`duplex`, for example). */
  init: RequestInit
}

/** The host of `mockClient`'s API; requests to others (storage) go unchecked. */
export const API_HOST = "api.test"

const offContract = new WeakSet<Response>()

/**
 * A reply that `mockClient` doesn't check against the contract: one that
 * breaks it on purpose (a gateway's HTML, an unknown error type).
 */
export function raw(response: Response): Response {
  offContract.add(response)
  return response
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
 * and records every call. Every request to the API, and every reply to one
 * not marked `raw`, must match the contract (openapi.json): a mismatch fails
 * the test when it ends.
 */
export function mockClient(
  replies: Reply[],
  options: ClientOptions = {}
): { nohead: Nohead; calls: Call[] } {
  const { fetch, calls } = mockFetch(replies)
  const nohead = new Nohead({
    apiKey: "nohead_sk_test",
    baseUrl: `https://${API_HOST}`,
    projectId: "prj_1",
    fetch,
    ...options,
  })
  return { nohead, calls }
}

/** The fetch of `mockClient`, for a client made otherwise. */
export function mockFetch(replies: Reply[]): {
  fetch: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const mismatches: string[] = []
  onTestFinished(() => {
    if (mismatches.length > 0) {
      throw new Error(`Off the contract:\n${mismatches.join("\n")}`)
    }
  })
  let index = 0
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = init.body
    const call: Call = {
      method: init.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : input),
      headers: new Headers(init.headers),
      body:
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw === undefined || raw === null
            ? undefined
            : raw,
      signal: init.signal ?? undefined,
      init,
    }
    calls.push(call)
    const api = call.url.host === API_HOST
    const problems = api ? requestProblems(call) : []
    mismatches.push(...problems)
    const reply = replies[Math.min(index++, replies.length - 1)]!
    if (reply instanceof Error) throw reply
    const response = typeof reply === "function" ? await reply(call) : reply
    if (api && problems.length === 0 && !offContract.has(response)) {
      mismatches.push(...(await checkReply(call, response)))
    }
    return response.clone()
  }
  return { fetch, calls }
}

async function checkReply(call: Call, response: Response): Promise<string[]> {
  const route = routeOf(call.method, call.url.pathname)
  const text = await response.clone().text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    return [`${route.id} ${response.status}: a reply that isn't JSON (raw?)`]
  }
  return replyProblems(route, response.status, body)
}

/**
 * What `promise` settles to, running fake timers (vi.useFakeTimers) until it
 * does, so the waits between attempts, and timeouts, take no time.
 */
export async function settle<T>(promise: PromiseLike<T>): Promise<T> {
  let done = false
  const outcome = Promise.allSettled([promise]).finally(() => (done = true))
  while (!done) await vi.runAllTimersAsync()
  const [result] = await outcome
  if (result.status === "rejected") throw result.reason
  return result.value
}

/**
 * The contract's example of what `operation` answers, with `fields` changed:
 * a reply that stays valid as the contract grows.
 */
export function exampleOf(
  operation: string,
  fields: Record<string, unknown> = {}
): Record<string, unknown> {
  const route = routes.find((r) => r.id === operation)
  if (!route) throw new Error(`No operation ${operation}`)
  return { ...(example(route.response.schema) as object), ...fields }
}

export const record = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  object: "record",
  collection_id: "col_1",
  collection: "posts",
  published_at: null,
  revision: 1,
  schema_version: 1,
  history_pruned_through: null,
  deleted_at: null,
  purge_after: null,
  data,
  created_at: "2026-10-02T12:00:00.000Z",
  updated_at: "2026-10-02T12:00:00.000Z",
})

/** A list's page; `has_more` is whether there's a cursor, unless given. */
export const page = (
  items: unknown[],
  next: string | null,
  hasMore = next !== null
) =>
  json(200, {
    data: items,
    meta: { next_cursor: next, has_more: hasMore },
  })
