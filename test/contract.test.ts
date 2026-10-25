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
import { describe, expect, it } from "vitest"

import { OPERATIONS } from "../src/generated/operations.gen.ts"
import { Page, PagePromise, type Nohead } from "../src/index.ts"
import { everyCall, exampleReplies, mockReply } from "./calls.ts"
import { API_HOST, mockClient } from "./helpers.ts"
import {
  OPTION_HEADERS,
  errors,
  queryNames,
  requestProblems,
  routeOf,
  routes,
} from "./spec.ts"

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
  (nohead) => nohead.assets.list({ content_type: "image/*", ...page }),
  (nohead) =>
    nohead.assets.list({ content_type: ["image/*", "application/pdf"] }),
  (nohead) => nohead.assets.list({ q: "hero jpg", kind: "image" }),
  (nohead) => nohead.assets.list({ kind: ["image", "video"] }),
  (nohead) => nohead.records.scheduledChanges("posts", page),
  (nohead) => nohead.records.drafts("rec_01J9ZQ3F8X", page),
  (nohead) =>
    nohead.drafts.list("posts", {
      sort: "updated_at",
      ...page,
    }),
  (nohead) => nohead.webhooks.secrets.list("wh_01J9ZQ3F8X", page),
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
  (nohead) => nohead.records.create("posts", { data: {} }, conditional),
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
      { name: "Title", key: "title", type: "text" },
      note
    ),
  (nohead) => nohead.fields.update(fld, { name: "Heading" }, note),
  (nohead) => nohead.fields.delete(fld, note),
  (nohead) => nohead.fields.restore(fld, note),
  (nohead) => nohead.fields.reorder("posts", { field_ids: [fld] }, note),
  (nohead) =>
    nohead.migrations.create(
      "posts",
      { field_id: fld, type: "long_text" },
      note
    ),
]

// The query parameters and option headers each operation was sent with,
// over every call below.
const sent = new Map<string, Set<string>>()
const headersSent = new Map<string, Set<string>>()
const add = (map: Map<string, Set<string>>, id: string, keys: string[]) =>
  map.set(id, new Set([...(map.get(id) ?? []), ...keys]))

/** A call's code on one line, as its test's name. */
const named = (call: (nohead: Nohead) => unknown) =>
  [
    String(call)
      .replace(/\s+/g, " ")
      .replace(/^\(nohead\) => nohead\./, "")
      .slice(0, 120),
    call,
  ] as const

describe("the contract", () => {
  it.each([...everyCall, ...everyParameter, ...everyHeader].map(named))(
    "is met by %s",
    async (_, call) => {
      let variant = 0
      const { nohead, calls } = mockClient([(c) => mockReply(c, variant)])
      // Once per variant of the reply, until the last.
      for (variant = 0; ; variant++) {
        const before = calls.length
        const promise = call(nohead)
        const result = await promise
        const apiCalls = calls
          .slice(before)
          .filter((c) => c.url.host === API_HOST)

        for (const request of apiCalls) {
          // mockClient checks it too, failing the test once it ends.
          expect(requestProblems(request)).toEqual([])
          const route = routeOf(request.method, request.url.pathname)
          add(sent, route.id, queryNames(request.url))
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
  )

  // These read what the calls above sent, so they run after them (Vitest runs
  // a file's tests in order).
  it("has a method for every operation", () => {
    const missing = Object.keys(OPERATIONS).filter((id) => !sent.has(id))
    expect(missing, "operations without an SDK method").toEqual([])
  })

  it("sends every query parameter from some call", () => {
    const unsent = Object.fromEntries(
      routes
        .map(({ id, query }): [string, string[]] => [
          id,
          query.map((p) => p.name).filter((p) => !sent.get(id)?.has(p)),
        ])
        .filter(([, params]) => params.length > 0)
    )
    expect(unsent, "query parameters no call sends").toEqual({})
  })

  it("sends If-Match and Nohead-Change-Note exactly where declared", () => {
    expect(
      Object.fromEntries(
        routes.map(({ id }) => [id, [...(headersSent.get(id) ?? [])].sort()])
      )
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
