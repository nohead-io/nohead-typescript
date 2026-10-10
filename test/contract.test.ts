// Every API-key operation in the contract must be reachable from the SDK's
// public methods, every request must match its operation (method, path,
// declared query parameters and their values, and the JSON body), and every
// declared query parameter must be sent by some call. A new operation or query
// parameter in openapi.json fails this test until a method takes it (and a
// call in calls.ts or below passes it). Each call gets the contract's example
// of its operation's response, and must return it.
import { Ajv2020 } from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

import { OPERATIONS } from "../src/generated/operations.gen.ts"
import { Page, PagePromise, type Nohead } from "../src/index.ts"
import { everyCall, exampleReply, mockReply } from "./calls.ts"
import { mockClient } from "./helpers.ts"
import { routeOf, routes, spec, type Parameter } from "./spec.ts"

const ajv = new Ajv2020({ strict: false, validateFormats: false })
ajv.addSchema(spec, "openapi.json")

/** The errors of `value` against the schema at `pointer` in the contract. */
function errors(pointer: string, value: unknown) {
  const validate = ajv.getSchema(`openapi.json${pointer}`)!
  return validate(value) ? [] : validate.errors
}

/**
 * A request's query parameters by name, as their schemas read them:
 * `filter[a][b]=v` nests, and numbers and booleans are parsed when declared.
 */
function queryValues(url: URL, params: Parameter[]) {
  const values: Record<string, unknown> = {}
  for (const [key, value] of url.searchParams) {
    const [name, ...path] = key.split(/[[\]]+/).filter(Boolean) as [string]
    if (path.length > 0) {
      let node = (values[name] ??= {}) as Record<string, unknown>
      for (const part of path.slice(0, -1)) {
        node = (node[part] ??= {}) as Record<string, unknown>
      }
      node[path.at(-1)!] = value
      continue
    }
    const type = params.find((p) => p.name === name)?.schema.type
    values[name] =
      (type === "integer" || type === "number") && /^-?\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : type === "boolean" && (value === "true" || value === "false")
          ? value === "true"
          : value
  }
  return values
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
    const sent = new Map<string, Set<string>>()
    for (const call of [...everyCall, ...everyParameter]) {
      const before = calls.length
      const promise = call(nohead)
      const result = await promise
      const apiCalls = calls
        .slice(before)
        .filter((c) => c.url.host === "api.test")

      for (const request of apiCalls) {
        const route = routeOf(request.method, request.url.pathname)
        const keys = [
          ...new Set(
            [...request.url.searchParams.keys()].map((k) =>
              k.replace(/\[.*$/, "")
            )
          ),
        ]
        expect(
          route.query.map((p) => p.name),
          `${route.id} query`
        ).toEqual(expect.arrayContaining(keys))
        const values = queryValues(request.url, route.query)
        for (const param of route.query.filter((p) => p.name in values)) {
          expect(
            errors(param.schemaAt, values[param.name]),
            `${route.id} ${param.name}`
          ).toEqual([])
        }
        if (request.body === undefined) {
          expect(route.bodyRequired, `${route.id} needs a body`).toBe(false)
        } else {
          expect(route.body, `${route.id} takes no body`).toBeDefined()
          expect(
            errors(route.body!.pointer, request.body),
            `${route.id} body`
          ).toEqual([])
        }
        sent.set(route.id, new Set([...(sent.get(route.id) ?? []), ...keys]))
      }

      // The method returns the response its last request got, parsed.
      const last = apiCalls.at(-1)!
      const reply = exampleReply(routeOf(last.method, last.url.pathname))
      if (promise instanceof PagePromise) {
        expect(result).toBeInstanceOf(Page)
        const { data, meta } = result as Page<unknown>
        expect({ data, meta }).toEqual(reply)
      } else {
        expect(result).toEqual(reply)
      }
    }

    const missing = Object.keys(OPERATIONS).filter((id) => !sent.has(id))
    expect(missing, "operations without an SDK method").toEqual([])
    const unsent = Object.fromEntries(
      routes
        .map(({ id, query }) => [
          id,
          query
            .map((p) => p.name)
            .filter(
              (p) => !sent.get(id)?.has(p) && !notForApiKeys[id]?.includes(p)
            ),
        ])
        .filter(([, params]) => params.length > 0)
    )
    expect(unsent, "query parameters no call sends").toEqual({})
  })

  it("has a valid example of every success response", () => {
    for (const route of routes) {
      expect(
        errors(route.response.pointer, exampleReply(route)),
        route.id
      ).toEqual([])
    }
  })
})
