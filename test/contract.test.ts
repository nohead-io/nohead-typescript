// Every API-key operation in the contract must be reachable from the SDK's
// public methods, every request must match its operation (method, path and
// declared query parameters), and every declared query parameter must be sent
// by some call. A new operation or query parameter in openapi.json fails this
// test until a method takes it (and a call in calls.ts or below passes it).
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { OPERATIONS } from "../src/generated/operations.gen.ts"
import { everyCall, mockReply } from "./calls.ts"
import { mockClient, type Call } from "./helpers.ts"
import type { Nohead } from "../src/index.ts"

interface Parameter {
  name: string
  in: string
  $ref?: string
}

const spec = JSON.parse(readFileSync("openapi.json", "utf8"))
const resolve = (p: Parameter): Parameter =>
  p.$ref ? spec.components.parameters[p.$ref.split("/").pop()!] : p

const routes = Object.entries(OPERATIONS).map(([id, { method, path }]) => {
  const item = spec.paths[path]
  const params = [
    ...(item.parameters ?? []),
    ...(item[method.toLowerCase()].parameters ?? []),
  ]
    .map(resolve)
    .filter((p) => p.in === "query")
    .map((p) => p.name)
  const pattern = new RegExp(`^${path.replace(/\{\w+\}/g, "[^/]+")}$`)
  return { id, method, pattern, params }
})

function operationOf(call: Call) {
  const route = routes.find(
    (r) => r.method === call.method && r.pattern.test(call.url.pathname)
  )
  if (!route)
    throw new Error(`No operation for ${call.method} ${call.url.pathname}`)
  return route
}

// Query parameters an API key has no use for: it always acts on its own
// project.
const notForApiKeys: Record<string, string[]> = {
  feature_flags_list: ["organization_id", "project_id"],
}

// Calls that pass the query parameters the samples in calls.ts leave out.
const page = { limit: 5, cursor: "cur_x" }
const everyParameter: ((nohead: Nohead) => unknown)[] = [
  (nohead) => nohead.records.list("posts", { cursor: "cur_x" }),
  (nohead) => nohead.records.revisions.list("rec_01J9ZQ3F8X", page),
  (nohead) => nohead.records.search("posts", "hello", page),
  (nohead) => nohead.search("hello", page),
  (nohead) => nohead.collections.list(page),
  (nohead) => nohead.collections.schemaChanges.list("posts", page),
  (nohead) => nohead.fields.list("posts", page),
  (nohead) => nohead.migrations.list("posts", page),
  (nohead) => nohead.assets.list({ content_type: ["image/*"], ...page }),
  (nohead) =>
    nohead.assets.imageUrl("ast_01J9ZQ3F8X", {
      height: 100,
      fit: "cover",
      quality: 80,
    }),
  (nohead) => nohead.webhooks.list(page),
  (nohead) => nohead.webhooks.deliveries.list("wh_01J9ZQ3F8X", page),
  (nohead) => nohead.auditEvents.list(page),
]

describe("the contract", () => {
  it("is covered by the SDK, request by request", async () => {
    const { nohead, calls } = mockClient([mockReply])
    await Promise.all(
      [...everyCall, ...everyParameter].map((call) =>
        Promise.resolve(call(nohead))
      )
    )

    const apiCalls = calls.filter((c) => c.url.host === "api.test")
    const sent = new Map<string, Set<string>>()
    for (const call of apiCalls) {
      const route = operationOf(call)
      const keys = [
        ...new Set(
          [...call.url.searchParams.keys()].map((k) => k.replace(/\[.*$/, ""))
        ),
      ]
      expect(route.params, `${route.id} query`).toEqual(
        expect.arrayContaining(keys)
      )
      sent.set(route.id, new Set([...(sent.get(route.id) ?? []), ...keys]))
    }
    const missing = Object.keys(OPERATIONS).filter((id) => !sent.has(id))
    expect(missing, "operations without an SDK method").toEqual([])
    const unsent = Object.fromEntries(
      routes
        .map(({ id, params }) => [
          id,
          params.filter(
            (p) => !sent.get(id)?.has(p) && !notForApiKeys[id]?.includes(p)
          ),
        ])
        .filter(([, params]) => params.length > 0)
    )
    expect(unsent, "query parameters no call sends").toEqual({})
  })
})
