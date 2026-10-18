// Every API-key operation in the contract must be reachable from the SDK's
// public methods, every request must match its operation (method, path,
// declared query parameters and their values, and the JSON body), and every
// declared query parameter must be sent by some call. A new operation or query
// parameter in openapi.json fails this test until a method takes it (and a
// call in calls.ts or below passes it). Each call gets the contract's examples
// of its operation's response, one per `oneOf` variant, and must return them.
// Methods offer `ifMatch` and `changeNote` exactly where their operation
// declares `If-Match` and `Nohead-Change-Note`: sent there (below), and not
// accepted elsewhere (by type, in Core.request; spot checks below).
import { Ajv2020 } from "ajv/dist/2020.js"
import { describe, expect, it } from "vitest"

import { OPERATIONS } from "../src/generated/operations.gen.ts"
import { Page, PagePromise, type Nohead } from "../src/index.ts"
import { everyCall, exampleReplies, mockReply } from "./calls.ts"
import { mockClient } from "./helpers.ts"
import {
  OPTION_HEADERS,
  routeOf,
  routes,
  spec,
  type Parameter,
} from "./spec.ts"

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
  (nohead) => nohead.records.scheduledChanges("posts", page),
  (nohead) => nohead.records.drafts("rec_01J9ZQ3F8X", page),
  (nohead) =>
    nohead.drafts.list("posts", {
      record_id: "rec_01J9ZQ3F8X",
      sort: "updated_at",
      ...page,
    }),
  (nohead) => nohead.webhooks.secrets.list("wh_01J9ZQ3F8X", page),
  (nohead) =>
    nohead.assets.imageUrl("ast_01J9ZQ3F8X", {
      height: 100,
      fit: "cover",
      quality: 80,
    }),
  (nohead) => nohead.webhooks.list(page),
  (nohead) => nohead.webhooks.deliveries.list("wh_01J9ZQ3F8X", page),
  (nohead) =>
    nohead.auditEvents.list({
      filter: {
        resource_type: ["collection", "field"],
        resource_id: "col_01J9ZQ3F8X",
        actor_type: "api_key",
        actor_id: "key_01J9ZQ3F8X",
      },
      ...page,
    }),
]

// Calls with the options sent as headers, for every operation that declares
// them.
const conditional = { ifMatch: 1, changeNote: "Why" }
const note = { changeNote: "Why" }
const rec = "rec_01J9ZQ3F8X"
const drf = "drf_01J9ZQ3F8X"
const fld = "fld_01J9ZQ3F8X"
const everyHeader: ((nohead: Nohead) => unknown)[] = [
  (nohead) => nohead.records.create("posts", { data: {} }, note),
  (nohead) => nohead.records.update(rec, { data: {} }, conditional),
  (nohead) => nohead.records.delete(rec, conditional),
  (nohead) => nohead.records.restore(rec, conditional),
  (nohead) => nohead.records.publish(rec, conditional),
  (nohead) => nohead.records.unpublish(rec, conditional),
  (nohead) =>
    nohead.records.bulk(
      "posts",
      { action: "publish", record_ids: [rec] },
      note
    ),
  (nohead) => nohead.records.revisions.revert(rec, 1, {}, conditional),
  (nohead) => nohead.drafts.update(drf, { data: {} }, { ifMatch: 1 }),
  (nohead) => nohead.drafts.discard(drf, { ifMatch: 1 }),
  (nohead) => nohead.drafts.merge(drf, conditional),
  (nohead) => nohead.collections.create({ name: "Posts", slug: "posts" }, note),
  (nohead) => nohead.collections.update("posts", { name: "Articles" }, note),
  (nohead) => nohead.collections.delete("posts", note),
  (nohead) => nohead.collections.restore("posts", note),
  (nohead) =>
    nohead.fields.create(
      "posts",
      { name: "Title", api_key: "title", type: "text" },
      note
    ),
  (nohead) => nohead.fields.update(fld, { name: "Heading" }, note),
  (nohead) => nohead.fields.delete(fld, note),
  (nohead) => nohead.fields.restore(fld, note),
  (nohead) => nohead.fields.reorder("posts", { field_ids: [fld] }, note),
  (nohead) => nohead.fields.migrate(fld, { type: "long_text" }, note),
]

describe("the contract", () => {
  it("is covered by the SDK, request by request", async () => {
    let variant = 0
    const { nohead, calls } = mockClient([(call) => mockReply(call, variant)])
    const sent = new Map<string, Set<string>>()
    const headersSent = new Map<string, Set<string>>()
    const add = (map: Map<string, Set<string>>, id: string, keys: string[]) =>
      map.set(id, new Set([...(map.get(id) ?? []), ...keys]))
    for (const call of [...everyCall, ...everyParameter, ...everyHeader]) {
      // Once per variant of the reply, until the last.
      for (variant = 0; ; variant++) {
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
          add(sent, route.id, keys)
          add(
            headersSent,
            route.id,
            OPTION_HEADERS.filter((name) => request.headers.has(name))
          )
        }

        // The method returns the response its last request got, parsed.
        const last = apiCalls.at(-1)!
        const replies = exampleReplies(
          routeOf(last.method, last.url.pathname),
          last.url
        )
        const reply = replies[Math.min(variant, replies.length - 1)]
        if (promise instanceof PagePromise) {
          expect(result).toBeInstanceOf(Page)
          const { data, meta } = result as Page<unknown>
          expect({ data, meta }).toEqual(reply)
        } else {
          expect(result).toEqual(reply)
        }
        if (variant >= replies.length - 1) break
      }
    }

    const missing = Object.keys(OPERATIONS).filter((id) => !sent.has(id))
    expect(missing, "operations without an SDK method").toEqual([])
    const unsent = Object.fromEntries(
      routes
        .map(({ id, query }): [string, string[]] => [
          id,
          query.map((p) => p.name).filter((p) => !sent.get(id)?.has(p)),
        ])
        .filter(([, params]) => params.length > 0)
    )
    expect(unsent, "query parameters no call sends").toEqual({})
    expect(
      Object.fromEntries(
        routes.map(({ id }) => [id, [...(headersSent.get(id) ?? [])].sort()])
      ),
      "If-Match and Nohead-Change-Note sent exactly where declared"
    ).toEqual(
      Object.fromEntries(routes.map(({ id, headers }) => [id, headers]))
    )
  })

  it("offers ifMatch and changeNote only where declared, by type", () => {
    // Never called: `npm run typecheck` fails if one of these compiles.
    const undeclared = (nohead: Nohead) => [
      // @ts-expect-error Assets keep no change note.
      nohead.assets.delete("ast_1", { changeNote: "Why" }),
      // @ts-expect-error Neither do draft updates.
      nohead.drafts.update("drf_1", { data: {} }, { changeNote: "Why" }),
      // @ts-expect-error Schedules take no If-Match.
      nohead.records.unschedule("rec_1", { ifMatch: 1 }),
      // @ts-expect-error Nor do schema writes.
      nohead.fields.delete("fld_1", { ifMatch: 1 }),
    ]
    expect(undeclared).toBeTypeOf("function")
  })

  it("has valid examples of every success response, one per variant", () => {
    for (const route of routes) {
      for (const dryRun of ["false", "true"]) {
        const url = new URL(`https://api.test/?dry_run=${dryRun}`)
        for (const reply of exampleReplies(route, url)) {
          expect(errors(route.response.pointer, reply), route.id).toEqual([])
        }
      }
    }
  })
})
