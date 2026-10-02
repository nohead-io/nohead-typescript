// Smoke test (Nohead spec §48.14): the core flow against a live API, using
// the built package. Needs NOHEAD_API_URL and NOHEAD_API_KEY (a key with
// schema and records read/write scopes). Exits non-zero on failure.
//
//   npm run build && NOHEAD_API_URL=http://localhost:3000 NOHEAD_API_KEY=sk_live_… npm run smoke
import { randomUUID } from "node:crypto"

import {
  Nohead,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from "../dist/index.js"

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
}

async function rejection(promise: PromiseLike<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  return undefined
}

interface Post {
  title: string
}

const nohead = new Nohead()

const me = await nohead.me.get()
expect(me.api_key?.project_id, "the key belongs to a project")

const collection = await nohead.collections.create({
  name: "TypeScript smoke",
  slug: `sdk-typescript-${randomUUID().slice(0, 8)}`,
  fields: [{ name: "Title", api_key: "title", type: "text", required: true }],
})

const key = randomUUID()
const first = await nohead.records.create<Post>(
  collection.slug,
  { data: { title: "One" } },
  { idempotencyKey: key }
)
const retried = await nohead.records.create<Post>(
  collection.slug,
  { data: { title: "One" } },
  { idempotencyKey: key }
)
expect(retried.id === first.id, "an idempotent retry returns the same record")
await nohead.records.create<Post>(collection.slug, { data: { title: "Two" } })

const got = await nohead.records.get<Post>(first.id)
expect(got.data.title === "One", "get returns the record")

const updated = await nohead.records.update<Post>(
  first.id,
  { data: { title: "Uno" } },
  { ifMatch: first }
)
expect(
  updated.data.title === "Uno" && updated.revision === first.revision + 1,
  "update writes a revision"
)
const stale = await rejection(
  nohead.records.update(
    first.id,
    { data: { title: "Stale" } },
    { ifMatch: first }
  )
)
expect(
  stale instanceof PreconditionFailedError &&
    stale.currentRevision === updated.revision,
  "a stale If-Match is a 412 with the current revision"
)

const page = await nohead.records.list<Post>(collection.slug, { limit: 1 })
expect(
  page.data.length === 1 && page.hasNextPage(),
  "the first page has one record and more"
)
const next = await page.getNextPage()
expect(
  next.data.length === 1 && next.data[0]!.id !== page.data[0]!.id,
  "the cursor returns the next page"
)
const titles: string[] = []
for await (const post of nohead.records.list<Post>(collection.slug, {
  limit: 1,
})) {
  titles.push(post.data.title)
}
expect(titles.sort().join() === "Two,Uno", "iterating walks every page")

const invalid = await rejection(
  nohead.records.create(collection.slug, { data: {} })
)
expect(invalid instanceof ValidationError, "validation errors are 422")
expect(
  invalid.details[0]?.field === "title",
  "validation details name the field"
)

const missing = await rejection(
  nohead.records.get("rec_01J9ZQ3F8X5W2K7M4N6P0R1S2T")
)
expect(
  missing instanceof NotFoundError && missing.requestId?.startsWith("req_"),
  "API errors deserialize"
)

const asset = await nohead.assets.upload(
  new Blob(["hello"], { type: "text/plain" }),
  {
    filename: "hello.txt",
  }
)
expect(
  asset.status === "ready" && asset.byte_size === 5,
  "assets upload to storage"
)

const deleted = await nohead.records.delete(first.id)
expect(deleted.deleted, "delete soft-deletes")
await nohead.collections.delete(collection.id)

console.log("typescript SDK smoke test passed")
