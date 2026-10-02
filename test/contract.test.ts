// Every API-key operation in the contract must be reachable from the SDK's
// public methods, and every request must match its operation: method, path
// and declared query parameters. A new operation in openapi.json fails this
// test until a method (and a call below) covers it.
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { OPERATIONS } from "../src/generated/operations.gen.ts"
import type { Nohead } from "../src/index.ts"
import { json, mockClient, page, record, type Call } from "./helpers.ts"

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

const upload = {
  object: "asset_upload",
  asset: { id: "ast_1", filename: "a.txt" },
  upload: {
    method: "PUT",
    url: "https://storage.test/u",
    headers: {},
    expires_at: "2026-10-02T13:00:00.000Z",
  },
}

function reply(call: Call): Response {
  if (call.url.host === "storage.test") return new Response(null)
  if (call.url.pathname.endsWith("/assets/uploads")) return json(201, upload)
  if (
    call.method === "GET" &&
    /\/(records|collections|fields|assets|webhooks|deliveries|revisions|schema-changes|migrations|audit-events|search)$/.test(
      call.url.pathname
    )
  ) {
    return page([record("rec_1")], null)
  }
  return json(200, record("rec_1"))
}

const everyMethod = (n: Nohead) => [
  n.records.list("posts", {
    filter: { status: "published" },
    sort: "-created_at",
    expand: ["author"],
    limit: 5,
  }),
  n.records.get("rec_1", { expand: ["author"], include_deleted: true }),
  n.records.create("posts", { data: { title: "Hi" } }),
  n.records.update("rec_1", { data: { title: "Hey" } }, { ifMatch: 1 }),
  n.records.delete("rec_1"),
  n.records.restore("rec_1"),
  n.records.publish("rec_1"),
  n.records.unpublish("rec_1"),
  n.records.schedule("rec_1", { publish_at: "2027-01-01T00:00:00Z" }),
  n.records.unschedule("rec_1"),
  n.records.count("posts", { filter: { status: "draft" } }),
  n.records.bulk("posts", { action: "publish", record_ids: ["rec_1"] }),
  n.records.diff("rec_1", { from: 1, to: 2 }),
  n.records.search("posts", "hello", {
    filter: { status: "published" },
    sort: "-published_at",
    expand: ["author"],
  }),
  n.records.revisions.list("rec_1", { filter: { operation: "update" } }),
  n.records.revisions.get("rec_1", 1),
  n.records.revisions.revert("rec_1", 1, { dry_run: true }),
  n.search("hello", {
    collections: ["posts"],
    filter: { status: "published" },
  }),
  n.collections.list({ deleted: true }),
  n.collections.get("posts"),
  n.collections.create({ name: "Posts", slug: "posts" }),
  n.collections.update("posts", { name: "Articles" }),
  n.collections.delete("posts"),
  n.collections.restore("posts"),
  n.collections.schema("posts", { version: 2 }),
  n.collections.schemaChanges.list("posts"),
  n.collections.schemaChanges.get("posts", "sch_1"),
  n.collections.searchIndex.get("posts"),
  n.collections.searchIndex.rebuild("posts"),
  n.fields.list("posts", { deleted: true }),
  n.fields.create("posts", { name: "Title", api_key: "title", type: "text" }),
  n.fields.update("fld_1", { name: "Heading" }),
  n.fields.delete("fld_1"),
  n.fields.restore("fld_1"),
  n.fields.reorder("posts", { field_ids: ["fld_1"] }),
  n.fields.removeAlias("fld_1", "old_title"),
  n.fields.migrate("fld_1", { type: "long_text", dry_run: true }),
  n.migrations.list("posts"),
  n.migrations.get("mig_1"),
  n.migrations.cancel("mig_1"),
  n.assets.upload(new Blob(["x"]), { filename: "a.txt" }),
  n.assets.list({ deleted: true }),
  n.assets.get("ast_1"),
  n.assets.delete("ast_1"),
  n.assets.restore("ast_1"),
  n.assets.imageUrl("ast_1", { width: 100, format: "webp" }),
  n.assets.downloadUrl("ast_1"),
  n.webhooks.list(),
  n.webhooks.get("wh_1"),
  n.webhooks.create({ url: "https://example.com/hook", event_types: ["*"] }),
  n.webhooks.update("wh_1", { enabled: false }),
  n.webhooks.delete("wh_1"),
  n.webhooks.rotateSecret("wh_1"),
  n.webhooks.test("wh_1"),
  n.webhooks.deliveries.list("wh_1", { status: "failed" }),
  n.webhooks.deliveries.get("whd_1"),
  n.webhooks.deliveries.retry("whd_1"),
  n.auditEvents.list({ filter: { action: "record.*" }, sort: "-id" }),
  n.featureFlags.list(),
  n.me.get(),
  n.health.check(),
]

describe("the contract", () => {
  it("is covered by the SDK, request by request", async () => {
    const { nohead, calls } = mockClient([reply])
    await Promise.all(everyMethod(nohead).map((p) => Promise.resolve(p)))

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
