// Every API-key operation in the contract must be reachable from the SDK's
// public methods, and every request must match its operation: method, path
// and declared query parameters. A new operation in openapi.json fails this
// test until a method (and a call below) covers it.
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { OPERATIONS } from "../src/generated/operations.gen.ts"
import { everyCall, mockReply } from "./calls.ts"
import { mockClient, type Call } from "./helpers.ts"

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

describe("the contract", () => {
  it("is covered by the SDK, request by request", async () => {
    const { nohead, calls } = mockClient([mockReply])
    await Promise.all(everyCall.map((call) => Promise.resolve(call(nohead))))

    const apiCalls = calls.filter((c) => c.url.host === "api.test")
    for (const call of apiCalls) {
      const route = operationOf(call)
      const sent = [
        ...new Set(
          [...call.url.searchParams.keys()].map((k) => k.replace(/\[.*$/, ""))
        ),
      ]
      expect(route.params, `${route.id} query`).toEqual(
        expect.arrayContaining(sent)
      )
    }
    const covered = new Set(apiCalls.map((c) => operationOf(c).id))
    const missing = Object.keys(OPERATIONS).filter((id) => !covered.has(id))
    expect(missing, "operations without an SDK method").toEqual([])
  })
})
