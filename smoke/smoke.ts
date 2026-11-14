// Smoke test (Nohead spec §48.14): the core flow against a live API, using
// the built package. Needs NOHEAD_API_URL (the API to test, which the client
// reads as its `baseUrl`) and NOHEAD_API_KEY (a key with schema, records, assets and
// webhooks read/write scopes). With NOHEAD_SEARCH_TOKEN (a search token of the
// key's project, made in the web app) and NOHEAD_SEARCH_URL (its search_url),
// it also searches with searchPublic. Exits non-zero on failure, after
// deleting what it created.
//
//   npm run build && NOHEAD_API_URL=http://localhost:3000 NOHEAD_API_KEY=nohead_sk_… npm run smoke
import { randomUUID } from "node:crypto"
import { openAsBlob, statSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  Nohead,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  type Uploadable,
  type UploadParams,
} from "../dist/index.js"
import { searchPublic, type ExpandedRecord } from "../dist/search.js"

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
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

// The API to test. Required, so that a missing variable doesn't run the test
// against production. The client reads it, and the key, as a script would.
expect(process.env.NOHEAD_API_URL, "NOHEAD_API_URL is set to the API to test")
const nohead = new Nohead()

// What the test created and has not deleted yet: deleted at the end, also
// when it fails.
const left = {
  collections: new Set<string>(),
  assets: new Set<string>(),
  webhooks: new Set<string>(),
}

// A 1×1 PNG, which the API checks is one.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
)
const text = (value: string) => new TextEncoder().encode(value)

/** `size` bytes in 64 KiB chunks, as a stream (which fetch sends as it reads). */
function stream(size: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      const chunk = Math.min(65_536, size - sent)
      controller.enqueue(new Uint8Array(chunk).fill(sent % 251))
      sent += chunk
      if (sent >= size) controller.close()
    },
  })
}

try {
  const me = await nohead.me.get()
  expect(me.api_key?.project_id, "the key belongs to a project")

  const collection = await nohead.collections.create({
    name: "TypeScript smoke",
    slug: `sdk-typescript-${randomUUID().slice(0, 8)}`,
    fields: [{ name: "Title", key: "title", type: "text", required: true }],
  })
  left.collections.add(collection.id)

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

  // Enough records for three pages of two: every one comes back, once.
  for (const title of ["Tres", "Cuatro", "Cinco"]) {
    await nohead.records.create<Post>(collection.slug, { data: { title } })
  }
  let pages = 1
  let walked = await nohead.records.list<Post>(collection.slug, { limit: 2 })
  while (walked.hasNextPage()) {
    walked = await walked.getNextPage()
    pages++
  }
  expect(pages === 3, `five records are three pages of two (got ${pages})`)
  const ids: string[] = []
  for await (const post of nohead.records.list<Post>(collection.slug, {
    limit: 2,
  })) {
    ids.push(post.id)
  }
  expect(
    ids.length === 5 && new Set(ids).size === 5,
    "iterating three pages returns every record once"
  )

  // A comma inside a value is escaped, or "Two" would match too.
  const chosen = await nohead.records.list<Post>(collection.slug, {
    filter: { title: { in: ["Uno", "Two, or not"] } },
  })
  expect(
    chosen.data.map((post) => post.data.title).join() === "Uno",
    "filters take operators"
  )

  const published = await nohead.records.publish<Post>(first.id)
  expect(published.published_at, "publish publishes")
  const publication = await nohead.records.publication(first.id)
  expect(
    publication.revision === published.revision,
    "the publication says which revision is live"
  )
  const draft = await nohead.drafts.create<Post>(first.id, {
    data: { title: "Uno, revised" },
  })
  expect(
    (await nohead.records.get<Post>(first.id)).data.title === "Uno",
    "a draft leaves the live record as it is"
  )
  const merged = await nohead.drafts.merge<Post>(draft.id, { ifMatch: draft })
  expect(
    merged.data.title === "Uno, revised" &&
      merged.published_at === published.published_at,
    "merging a draft changes the content, not the publication"
  )
  const unpublished = await nohead.records.unpublish<Post>(first.id)
  expect(unpublished.published_at === null, "unpublish takes it back")

  const live = await nohead.records.create<Post>(collection.slug, {
    data: { title: "Live" },
    publish: true,
  })
  expect(
    live.published_at !== null && live.revision === 2,
    "create with publish creates it published"
  )

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

  // Every kind of file upload takes, through storage's signature check.
  const here = fileURLToPath(import.meta.url)
  const uploads: [string, Uploadable, UploadParams, number, string][] = [
    [
      "a Blob",
      new Blob(["hello"], { type: "text/plain" }),
      { filename: "hello.txt" },
      5,
      "text/plain",
    ],
    [
      "a File",
      new File([PNG], "pixel.png", { type: "image/png" }),
      { alt: "A one-pixel image" },
      PNG.byteLength,
      "image/png",
    ],
    [
      "a Blob from disk (openAsBlob)",
      await openAsBlob(here),
      { filename: "smoke.ts" },
      statSync(here).size,
      "application/octet-stream",
    ],
    [
      "an ArrayBuffer",
      text("# Notes\n").buffer,
      { filename: "notes.md" },
      8,
      "text/markdown",
    ],
    [
      "a Uint8Array",
      text('{"a":1}'),
      { filename: "data.json" },
      7,
      "application/json",
    ],
    [
      "a ReadableStream",
      stream(200_000),
      { filename: "stream.csv", byte_size: 200_000 },
      200_000,
      "text/csv",
    ],
  ]
  for (const [kind, file, params, byteSize, contentType] of uploads) {
    const uploaded = await nohead.assets.upload(file, params)
    left.assets.add(uploaded.id)
    expect(
      uploaded.status === "ready" &&
        uploaded.byte_size === byteSize &&
        uploaded.content_type === contentType,
      `${kind} uploads (${uploaded.status}, ${uploaded.byte_size} bytes, ${uploaded.content_type})`
    )
  }
  const pixel = await nohead.assets.get([...left.assets][1]!)
  expect(pixel.alt === "A one-pixel image", "upload sets alt text")
  const asset = await nohead.assets.get([...left.assets][0]!)
  expect(asset.filename === "hello.txt", "assets get")

  const renamed = await nohead.assets.update(asset.id, {
    filename: "greeting.txt",
  })
  expect(renamed.filename === "greeting.txt", "assets rename")

  for (const id of left.assets) {
    const deletedAsset = await nohead.assets.delete(id)
    expect(deletedAsset.deleted_at, "assets soft-delete")
    await nohead.assets.purge(id)
    left.assets.delete(id)
  }

  const webhook = await nohead.webhooks.create({
    url: "https://example.com/nohead-smoke",
    event_types: ["record.published"],
  })
  left.webhooks.add(webhook.id)
  const rotated = await nohead.webhooks.rotateSecret(webhook.id)
  expect(
    webhook.secret.startsWith("whsec_") && rotated.secret !== webhook.secret,
    "rotating a webhook's secret adds one"
  )
  const secrets = await nohead.webhooks.secrets.list(webhook.id)
  expect(
    secrets.data.length === 2,
    "the old secret signs alongside the new one"
  )
  expect(
    (await nohead.webhooks.delete(webhook.id)).deleted_at,
    "webhooks delete"
  )
  left.webhooks.delete(webhook.id)

  // Public search, as a site's search box reads it: against the real search
  // engine, with a relation's names in hits and marked where they matched.
  const searchToken = process.env.NOHEAD_SEARCH_TOKEN
  if (searchToken) {
    const searchUrl = process.env.NOHEAD_SEARCH_URL
    expect(searchUrl, "NOHEAD_SEARCH_URL is set to the search engine to test")
    const suffix = randomUUID().slice(0, 8)
    const people = await nohead.collections.create({
      name: "TypeScript smoke people",
      slug: `sdk-typescript-people-${suffix}`,
      fields: [{ name: "Name", key: "name", type: "text", required: true }],
    })
    left.collections.add(people.id)
    const name = people.fields[0]!.id
    // Hits return the authors' names, and searches match them.
    const authors = {
      target_collection_id: people.id,
      searchable: true,
      expanded: [name],
      searched: [name],
    }
    const posts = await nohead.collections.create({
      name: "TypeScript smoke posts",
      slug: `sdk-typescript-posts-${suffix}`,
      public_search: true,
      fields: [
        { name: "Title", key: "title", type: "text", required: true },
        {
          name: "Authors",
          key: "authors",
          type: "relation",
          multiple: true,
          configuration: authors,
        },
      ],
    })
    left.collections.add(posts.id)
    const ada = await nohead.records.create(people.slug, {
      data: { name: "Ada Lovelace" },
      publish: true,
    })
    await nohead.records.create(posts.slug, {
      data: { title: "Notes on the engine", authors: [ada.id] },
      publish: true,
    })
    const { index } = await nohead.collections.searchIndex.get(posts.id)
    const search = () =>
      searchPublic<
        { title: string },
        { authors: ExpandedRecord<{ name: string }>[] }
      >({
        token: searchToken,
        index,
        q: "lovelace engine",
        highlight: ["title", "authors.name"],
        baseUrl: searchUrl,
      })
    // Indexed in the background: until then, no index or no hit.
    let found: Awaited<ReturnType<typeof search>> | undefined
    let failure: unknown
    for (const deadline = Date.now() + 30_000; Date.now() < deadline;) {
      found = await search().catch((error: unknown) => {
        failure = error
        return undefined
      })
      if (found?.hits.length) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const hit = found?.hits[0]
    expect(
      found?.hits.length === 1 && hit,
      `a search token finds the published post (last error: ${String(failure)})`
    )
    const author = hit.expanded.authors?.[0]
    expect(
      author?.data.name === "Ada Lovelace",
      "hits return the related fields the relation lists"
    )
    expect(
      hit.highlights.title?.some((s) => s.match && s.text === "engine"),
      "a hit's field is marked where it matched"
    )
    expect(
      author.highlights?.name?.some((s) => s.match && s.text === "Lovelace"),
      "a related record's field is marked where it matched"
    )
    // Posts first: their relation points at People.
    for (const collection of [posts, people]) {
      await nohead.collections.delete(collection.id)
      left.collections.delete(collection.id)
    }
  }

  const deleted = await nohead.records.delete(first.id)
  expect(deleted.deleted_at, "delete soft-deletes")
  await nohead.collections.delete(collection.id)
  left.collections.delete(collection.id)
} finally {
  for (const [resource, ids] of Object.entries(left)) {
    // The last created first, so a relation goes before what it points at.
    for (const id of [...ids].reverse()) {
      await nohead[resource as keyof typeof left].delete(id).catch(() => {})
    }
  }
}

console.log("typescript SDK smoke test passed")
