// One call per API-key operation, with arguments as the docs should show
// them. The contract test runs every call against the contract, and
// scripts/samples.ts turns each into the API reference's code sample for the
// operation it calls (samples.json).
import type { Nohead } from "../src/index.ts"
import { json, type Call } from "./helpers.ts"
import { example, routeOf, type Route } from "./spec.ts"

export const everyCall: ((nohead: Nohead) => unknown)[] = [
  (nohead) =>
    nohead.records.list("posts", {
      filter: { status: "published" },
      sort: "-created_at",
      expand: ["author"],
      limit: 5,
    }),
  (nohead) =>
    nohead.records.get("rec_01J9ZQ3F8X", {
      expand: ["author"],
      include_deleted: true,
    }),
  (nohead) => nohead.records.create("posts", { data: { title: "Hi" } }),
  (nohead) =>
    nohead.records.update(
      "rec_01J9ZQ3F8X",
      { data: { title: "Hey" } },
      { ifMatch: 1 }
    ),
  (nohead) => nohead.records.delete("rec_01J9ZQ3F8X"),
  (nohead) => nohead.records.restore("rec_01J9ZQ3F8X"),
  (nohead) => nohead.records.publish("rec_01J9ZQ3F8X"),
  (nohead) => nohead.records.unpublish("rec_01J9ZQ3F8X"),
  (nohead) =>
    nohead.records.schedule("rec_01J9ZQ3F8X", {
      publish_at: "2027-01-01T00:00:00Z",
    }),
  (nohead) => nohead.records.unschedule("rec_01J9ZQ3F8X"),
  (nohead) => nohead.records.count("posts", { filter: { status: "draft" } }),
  (nohead) =>
    nohead.records.bulk("posts", {
      action: "publish",
      record_ids: ["rec_01J9ZQ3F8X"],
    }),
  (nohead) => nohead.records.diff("rec_01J9ZQ3F8X", { from: 1, to: 2 }),
  (nohead) =>
    nohead.records.search("posts", "hello", {
      filter: { status: "published" },
      sort: "-published_at",
      expand: ["author"],
    }),
  (nohead) =>
    nohead.records.revisions.list("rec_01J9ZQ3F8X", {
      filter: { operation: "update" },
    }),
  (nohead) => nohead.records.revisions.get("rec_01J9ZQ3F8X", 1),
  (nohead) =>
    nohead.records.revisions.revert("rec_01J9ZQ3F8X", 1, { dry_run: true }),
  (nohead) =>
    nohead.search("hello", {
      collections: ["posts"],
      filter: { status: "published" },
    }),
  (nohead) => nohead.collections.list({ deleted: true }),
  (nohead) => nohead.collections.get("posts"),
  (nohead) => nohead.collections.create({ name: "Posts", slug: "posts" }),
  (nohead) => nohead.collections.update("posts", { name: "Articles" }),
  (nohead) => nohead.collections.delete("posts"),
  (nohead) => nohead.collections.restore("posts"),
  (nohead) => nohead.collections.schema("posts", { version: 2 }),
  (nohead) => nohead.collections.schemaChanges.list("posts"),
  (nohead) => nohead.collections.schemaChanges.get("posts", "sch_01J9ZQ3F8X"),
  (nohead) => nohead.collections.searchIndex.get("posts"),
  (nohead) => nohead.collections.searchIndex.rebuild("posts"),
  (nohead) => nohead.fields.list("posts", { deleted: true }),
  (nohead) =>
    nohead.fields.create("posts", {
      name: "Title",
      api_key: "title",
      type: "text",
    }),
  (nohead) => nohead.fields.update("fld_01J9ZQ3F8X", { name: "Heading" }),
  (nohead) => nohead.fields.delete("fld_01J9ZQ3F8X"),
  (nohead) => nohead.fields.restore("fld_01J9ZQ3F8X"),
  (nohead) => nohead.fields.reorder("posts", { field_ids: ["fld_01J9ZQ3F8X"] }),
  (nohead) => nohead.fields.removeAlias("fld_01J9ZQ3F8X", "old_title"),
  (nohead) =>
    nohead.fields.migrate("fld_01J9ZQ3F8X", {
      type: "long_text",
      dry_run: true,
    }),
  (nohead) => nohead.migrations.list("posts"),
  (nohead) => nohead.migrations.get("mig_01J9ZQ3F8X"),
  (nohead) => nohead.migrations.cancel("mig_01J9ZQ3F8X"),
  (nohead) =>
    nohead.assets.upload(new Blob(["Hello"], { type: "text/plain" }), {
      filename: "hello.txt",
    }),
  (nohead) =>
    nohead.assets.createUpload({
      filename: "hello.txt",
      content_type: "text/plain",
      byte_size: 5,
    }),
  (nohead) => nohead.assets.complete("ast_01J9ZQ3F8X"),
  (nohead) => nohead.assets.list({ deleted: true }),
  (nohead) => nohead.assets.get("ast_01J9ZQ3F8X"),
  (nohead) => nohead.assets.delete("ast_01J9ZQ3F8X"),
  (nohead) => nohead.assets.restore("ast_01J9ZQ3F8X"),
  (nohead) => nohead.assets.purge("ast_01J9ZQ3F8X"),
  (nohead) => nohead.assets.usage("ast_01J9ZQ3F8X"),
  (nohead) =>
    nohead.assets.imageUrl("ast_01J9ZQ3F8X", { width: 100, format: "webp" }),
  (nohead) => nohead.assets.downloadUrl("ast_01J9ZQ3F8X"),
  (nohead) => nohead.webhooks.list(),
  (nohead) => nohead.webhooks.get("wh_01J9ZQ3F8X"),
  (nohead) =>
    nohead.webhooks.create({
      url: "https://example.com/hook",
      event_types: ["*"],
    }),
  (nohead) => nohead.webhooks.update("wh_01J9ZQ3F8X", { enabled: false }),
  (nohead) => nohead.webhooks.delete("wh_01J9ZQ3F8X"),
  (nohead) => nohead.webhooks.rotateSecret("wh_01J9ZQ3F8X"),
  (nohead) => nohead.webhooks.test("wh_01J9ZQ3F8X"),
  (nohead) =>
    nohead.webhooks.deliveries.list("wh_01J9ZQ3F8X", { status: "failed" }),
  (nohead) => nohead.webhooks.deliveries.get("whd_01J9ZQ3F8X"),
  (nohead) => nohead.webhooks.deliveries.retry("whd_01J9ZQ3F8X"),
  (nohead) =>
    nohead.auditEvents.list({ filter: { action: "record.*" }, sort: "-id" }),
  (nohead) => nohead.featureFlags.list(),
  (nohead) => nohead.me.get(),
  (nohead) => nohead.health.check(),
]

/**
 * The reply to any of the calls above: the contract's example of the
 * operation's success response (spec.ts), with an upload URL on storage.
 */
export function mockReply(call: Call): Response {
  if (call.url.host === "storage.test") return new Response(null)
  const route = routeOf(call.method, call.url.pathname)
  return json(route.status, exampleReply(route))
}

/** The body of `mockReply` for an operation. */
export function exampleReply(route: Route): unknown {
  const body = example(route.response.schema)
  if (route.id === "assets_upload") {
    const { upload } = body as { upload: { url: string } }
    upload.url = "https://storage.test/u"
  }
  return body
}
