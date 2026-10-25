# Nohead TypeScript SDK

The official TypeScript client for the [Nohead](https://nohead.io) API: typed records, pagination you can loop over, retries that are safe for writes, one-call uploads and webhook verification. No runtime dependencies.

```ts
import { Nohead } from "@nohead/sdk"

const nohead = new Nohead() // reads NOHEAD_API_KEY

for await (const post of nohead.records.list("posts", {
  filter: { published_at: { exists: true } },
})) {
  console.log(post.data.title)
}
```

> **Status:** 0.x until the Nohead API launches.

## Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Records](#records)
- [Drafts](#drafts)
- [Pagination](#pagination)
- [Errors](#errors)
- [Retries and idempotency](#retries-and-idempotency)
- [Concurrency](#concurrency)
- [Assets](#assets)
- [Search](#search)
- [Schema](#schema)
- [Webhooks](#webhooks)
- [Raw responses](#raw-responses)
- [Reference](#reference)
- [Development](#development)

## Installation

```bash
npm install @nohead/sdk
```

The package is ESM; Node 22+ can also `require()` it. It runs on Node 22, 24 and 26, Bun, Deno, Cloudflare Workers and other runtimes with `fetch`, Web Crypto and ES2024. Use it on servers: API keys are secrets.

## Configuration

```ts
const nohead = new Nohead({
  apiKey: process.env.NOHEAD_API_KEY, // default: NOHEAD_API_KEY
  baseUrl: "https://api.nohead.io", // default: NOHEAD_API_URL, else production
})
```

| Option       | Default                                        |                                                                                    |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apiKey`     | `NOHEAD_API_KEY`                               | A project API key (`nohead_sk_…`, or `nohead_pk_…` when published-only). Required. |
| `baseUrl`    | `NOHEAD_API_URL`, else `https://api.nohead.io` |                                                                                    |
| `projectId`  | the key's project                              | Looked up once with `GET /v1/me` when omitted.                                     |
| `maxRetries` | `2`                                            | See [retries](#retries-and-idempotency).                                           |
| `timeout`    | `60000`                                        | Milliseconds per attempt.                                                          |
| `fetch`      | `globalThis.fetch`                             | For proxies, instrumentation and tests.                                            |
| `headers`    | `{}`                                           | Added to every request.                                                            |
| `warnings`   | `true`                                         | Logs deprecation and plan usage warnings, once each.                               |
| `onRetry`    |                                                | Called before each retry. See [retries](#retries-and-idempotency).                 |

API keys belong to a project, so methods like `collections.list()` need no project ID. Collections can be named by ID or slug everywhere.

## Records

```ts
const created = await nohead.records.create("posts", {
  data: { title: "Hello", author: "rec_01J9…" },
})
const post = await nohead.records.get(created.id, { expand: ["author"] })
await nohead.records.update(post.id, { data: { title: "Hello again" } })
await nohead.records.publish(post.id)
await nohead.records.publication(post.id) // since when, by whom, which revision
await nohead.records.schedule(post.id, { unpublish_at: new Date("2027-01-01") })
await nohead.records.delete(post.id) // soft delete; records.restore() undoes it
```

`schedule` sets the whole schedule: a time left out is cleared, so `{ unpublish_at }` alone drops a pending publish.

**Upserts.** With `upsert_on`, the key of a `unique` field, `create` updates the record holding that value instead, if one exists, so a content sync can run again without duplicates:

```ts
await nohead.records.create("products", {
  data: { sku: "TEE-01", title: "Tee" },
  upsert_on: "sku",
})
```

Methods return the resource and throw on failure. Field names stay as the API sends them (`published_at`, `data`), so the API reference applies as-is.

**Typed data.** Describe a collection's fields and pass the type:

```ts
interface Post {
  title: string
  author: string
}

const post = await nohead.records.get<Post>(id) // post.data.title: string
await nohead.records.update<Post>(id, { data: { title: null } }) // null clears
```

The type is a promise you make; nothing is checked at runtime. The record type itself is `Nohead.Record<Post>` (also exported as `NoheadRecord`).

**More:** `count`, `bulk` (up to 100 records at once), `diff`, `revisions.list`, `revisions.get` and `revisions.revert` (with `{ dry_run: true }` for a preview). A revision by its own ID, as webhooks and the activity log name it: `nohead.revisions.get("rev_…")`.

## Drafts

A draft holds changes to a record until they are merged, now or at a set time, while the record keeps its current content: changes to review before they go live, or changes due later.

```ts
const draft = await nohead.drafts.create(post.id, {
  data: { title: "Hello, revised" },
})
await nohead.drafts.update(
  draft.id,
  { data: { summary: "…" } },
  { ifMatch: draft }
)
const preview = await nohead.drafts.get(draft.id, { expand: ["author"] }) // data as it would read
await nohead.drafts.merge(draft.id) // or drafts.schedule(draft.id, { merge_at })
```

- A record has at most one draft; starting a second is a `ConflictError` (detail code `draft_exists`, with its `draft_id`).
- A merge changes content only: a live record stays live, an unpublished one unpublished. Publishing a live record with a pending draft is a `ConflictError` (`draft_pending`).
- `records.drafts(id)` lists a record's draft, and `drafts.list(collection)` a collection's.
- `drafts.discard` deletes one for good.
- Drafts take the type of their data as records do: `drafts.get<Post>(id)` is a `Nohead.Draft<Post>` (also exported as `NoheadDraft`).

## Pagination

List methods return a promise of the first page that you can also loop over:

```ts
// Every record, fetching pages as needed
for await (const record of nohead.records.list("posts")) { … }

// One page at a time
let page = await nohead.records.list("posts", { limit: 100 })
page.data // this page's records
page.meta // { next_cursor, has_more }
while (page.hasNextPage()) page = await page.getNextPage()

// Resume from a saved cursor
await nohead.records.list("posts", { cursor: page.meta.next_cursor! })
```

Filters take a value to equal, or operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in` (a list) and `exists`. They combine with AND. On fields with several values, equal means "contains". Values are strings, numbers, booleans and dates. A `Date` is sent as a moment, for date fields with a time; a plain date field takes its `YYYY-MM-DD` string, and both take `"today"` (dates with a time `"now"` too). Lists sort by a field too, with records that have no value last:

```ts
nohead.records.list("posts", {
  filter: {
    published_at: { exists: true },
    featured: true,
    author: "rec_01J9…",
  },
  sort: "-published_at",
  expand: ["author", "tags"],
})

nohead.records.list("products", {
  filter: {
    price: { lt: 50 },
    category: { in: ["shoes", "bags"] },
    cover: { exists: true },
  },
  sort: "price",
})
```

## Errors

Every error is a `NoheadError`. API errors are `APIError`s with `status`, `type`, `message`, `requestId`, `details` and `headers`, in a class per type:

| Class                     | Status                  |
| ------------------------- | ----------------------- |
| `InvalidRequestError`     | 400                     |
| `AuthenticationError`     | 401                     |
| `PlanLimitExceededError`  | 402                     |
| `AuthorizationError`      | 403                     |
| `NotFoundError`           | 404                     |
| `ConflictError`           | 409                     |
| `PreconditionFailedError` | 412 (`currentRevision`) |
| `ValidationError`         | 422                     |
| `RateLimitError`          | 429 (`retryAfter`)      |
| `InternalServerError`     | 500 and other 5xx       |
| `ServiceUnavailableError` | 503                     |

An API error's `message` names the status, the type and the request ID along with the API's message, so logging it is enough to look the request up: `422 validation_error: Title is required (request req_…)`.

Other errors: `ConnectionError`, `TimeoutError` (a `ConnectionError`), `AbortError` (your `signal` fired), `UploadError` and `WebhookVerificationError`.

```ts
import { ValidationError } from "@nohead/sdk"

try {
  await nohead.records.create("posts", { data: {} })
} catch (error) {
  if (error instanceof ValidationError) {
    console.log(error.details) // [{ field: "title", code: "required", message: "…" }]
  } else {
    throw error
  }
}
```

## Retries and idempotency

Failed requests are retried twice by default (`maxRetries`), with exponential backoff:

- what's retried: connection errors, timeouts, 429, 500, 502, 503, 504, and a 409 for a request that is still running
- `Retry-After` is honored up to 60 seconds; a longer one throws `RateLimitError` straight away

To report retries, pass `onRetry`. It gets the retry's `attempt` (1 for the first), `delay` in seconds, `url`, the failed `status` (none when the connection failed) and the `error`:

```ts
const nohead = new Nohead({
  onRetry: ({ attempt, delay, status }) =>
    console.error(
      `Retry ${attempt} in ${delay.toFixed(1)}s (${status ?? "network"})`
    ),
})
```

Every write gets an `Idempotency-Key` that stays the same across its retries, so a retry after a lost response never writes twice. To make a write safe across your own retries (a job that may run twice), pass a key:

```ts
await nohead.records.create(
  "posts",
  { data },
  { idempotencyKey: `import-${row.id}` }
)
```

Every method takes request options as its last argument:

- `idempotencyKey`
- `signal`, `timeout`, `maxRetries` and `headers`

Writes that change records or the schema also take `changeNote`, a reason kept with the revision, schema change or migration they make. Record and draft writes take `ifMatch` (see [concurrency](#concurrency)).

## Concurrency

Pass the revision you read to make sure nobody changed the record since:

```ts
const post = await nohead.records.get(id)
try {
  await nohead.records.update(id, { data: { title } }, { ifMatch: post })
} catch (error) {
  if (error instanceof PreconditionFailedError) {
    // changed since: reload, and merge or ask
  }
}
```

`ifMatch` takes a record or a revision number, on `records.update`, `delete`, `restore`, `publish`, `unpublish` and `revisions.revert`, and a draft or its revision on `drafts.update`, `discard` and `merge`.

## Assets

```ts
import { openAsBlob } from "node:fs"

const asset = await nohead.assets.upload(await openAsBlob("cover.jpg"), {
  filename: "cover.jpg",
})
await nohead.records.update(id, { data: { cover: asset.id } })
```

**Images.** Image URLs are open: an image's `image_url` serves the whole image, and any of [imgproxy's processing options](https://docs.imgproxy.net/usage/processing) written into it transform it. `@nohead/sdk/images` builds them without a request, and has no dependencies, so it suits browser bundles:

```ts
import { imageUrl } from "@nohead/sdk/images"

imageUrl(asset, {
  width: 1200,
  height: 630,
  fit: "cover",
  gravity: "sm",
  format: "webp",
})
imageUrl(asset.image_url!, { width: 400, dpr: 2, options: ["bl:2"] })
```

Frameworks' image components, with `srcset` and all, take a loader from it:

- **Next.js:** a file named by `images.loaderFile` in next.config: `export { nextImageLoader as default } from "@nohead/sdk/images"`, then `<Image src={asset.image_url} … />`.
- **Astro:** a module named by `image.service.entrypoint` in astro.config: `export { astroImageService as default } from "@nohead/sdk/images"`.
- **Nuxt Image:** a custom provider file in nuxt.config's `image.providers`: `export { nuxtImageProvider as default } from "@nohead/sdk/images"` (Nuxt Image 1: `export { getImage } from "@nohead/sdk/images"`).

The loaders leave other images, the site's own, as they are.

Thumbnails: an image's `preview_url` fits in 640×640, as WebP.

**What `upload` accepts:** a `Blob`, `File`, `ArrayBuffer`, `Uint8Array`, or a `ReadableStream` with `byte_size`.

**What it does:**

1. Creates the upload.
2. Sends the bytes straight to storage.
3. Completes the upload, which checks the file, and returns the `ready` asset.

**Errors:** `UploadError` if storage refuses the bytes; `ValidationError` if the file fails the checks.

**Resuming:** pass an `idempotencyKey` (`upload(file, {}, { idempotencyKey })`) and running the same upload again resumes it: an asset that is already `ready` comes back without sending the bytes again. Once the upload's URL has expired (its `upload.expires_at`), it throws `UploadError`: start over with a new key.

**Uploading from a browser:** create the upload on your server with `createUpload`, `PUT` the file from the browser, then `complete` it.

**Renaming and alt text:** `update` changes an asset's `filename` and `alt` text, the default wherever the asset is used (`expand` returns it with the asset). The file itself never changes.

```ts
await nohead.assets.update(asset.id, {
  alt: "The spring menu, on a chalkboard",
})
```

**Deleting:** `delete` keeps a deleted asset until its `purge_after` (30 days), and `restore` brings it back. To remove it for good now, `purge` it after the delete. Records that use it keep an ID that no longer resolves, so check `usage` first:

```ts
const usage = await nohead.assets.usage(asset.id)
usage.records // how many records use it, usage.published of them published
usage.uses // the 10 most recently updated, with the fields that use it
```

## Search

```ts
// One collection
for await (const hit of nohead.records.search("posts", "content model")) { … }

// Across the project
const results = await nohead.search("content model", { collections: ["posts", "pages"] })
results.meta.total_estimate
```

Search needs the `search:read` scope and covers every collection the key can read, matching their `searchable` fields. It pages through the first 1,000 hits. For search straight from a site's browser, without the API, use a search token from the web app with Meilisearch's own clients or InstantSearch.

## Schema

```ts
const posts = await nohead.collections.create({
  name: "Posts",
  slug: "posts",
  fields: [{ name: "Title", key: "title", type: "text", required: true }],
})
await nohead.fields.create("posts", {
  name: "Summary",
  key: "summary",
  type: "long_text",
})

// Changes that rewrite records go through a migration; preview first
const preview = await nohead.migrations.create("posts", {
  field_id: "fld_…",
  type: "long_text",
  dry_run: true,
})
const migration = await nohead.migrations.create("posts", {
  field_id: "fld_…",
  type: "long_text",
})
await nohead.migrations.get(migration.id)
```

For schema as code, see the `nohead` CLI (`nohead schema pull/diff/push`).

## Webhooks

Verify a webhook request, then use its event:

```ts
// e.g. a Next.js route handler
import { revalidateTag } from "next/cache"

export async function POST(request: Request) {
  const event = await nohead.webhooks.unwrap(
    await request.text(),
    request.headers,
    {
      secret: process.env.NOHEAD_WEBHOOK_SECRET!,
    }
  )
  if (event.type === "record.published" && event.data.record) {
    revalidateTag(event.data.record.collection, "max")
  }
  return new Response(null, { status: 204 })
}
```

With `"max"`, Next.js serves the old version to the next request while it fetches the new one; pass `{ expire: 0 }` instead to drop it at once.

Event types are those of the activity log (`record.published`, `record.restored`, `field.updated`, `asset.purged`, …), and a webhook subscribes to types or wildcards (`record.*`, `*`). Narrowing by `type` types `event.data`, and `unwrap<Post>` types the records and drafts in it. `unwrap` checks the signature and the timestamp (Standard Webhooks), and throws `WebhookVerificationError` if either is off. After `rotateSecret`, requests carry a signature for the old secret and the new one for 24 hours, so switch the receiver's secret within that day (or end it sooner with `webhooks.secrets.retire`). Pass the raw body: parsing and re-serializing JSON changes the bytes.

A receiver that never calls the API can use `unwrapWebhook` from `@nohead/sdk/webhooks` without a client. Events can arrive more than once, so deduplicate by the `webhook-id` header.

## Raw responses

```ts
const { data, response, requestId } = await nohead.records
  .get(id)
  .withResponse()
response.headers.get("RateLimit-Remaining")
```

## Reference

| Resource                    | Methods                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `records`                   | `list`, `get`, `create`, `update`, `delete`, `restore`, `publish`, `unpublish`, `publication`, `getSchedule`, `schedule`, `unschedule`, `scheduledChanges`, `drafts`, `count`, `bulk`, `diff`, `search` |
| `drafts`                    | `create`, `list`, `get`, `update`, `discard`, `merge`, `schedule`, `unschedule`                                                                                                                         |
| `records.revisions`         | `list`, `get`, `revert`                                                                                                                                                                                 |
| `revisions`                 | `get` (by its own `rev_` ID, as webhooks and the activity log name it)                                                                                                                                  |
| `search`                    | across the project                                                                                                                                                                                      |
| `collections`               | `list`, `get`, `create`, `update`, `delete`, `restore`, `schema`                                                                                                                                        |
| `collections.schemaChanges` | `list`, `get`                                                                                                                                                                                           |
| `collections.searchIndex`   | `get`, `rebuild`                                                                                                                                                                                        |
| `fields`                    | `list`, `get`, `create`, `update`, `delete`, `restore`, `order`, `reorder`, `removeAlias`                                                                                                               |
| `migrations`                | `create`, `list`, `get`, `cancel`                                                                                                                                                                       |
| `assets`                    | `upload`, `createUpload`, `complete`, `list`, `get`, `update`, `delete`, `restore`, `purge`, `usage`                                                                                                    |
| `webhooks`                  | `list`, `get`, `create`, `update`, `delete`, `restore`, `rotateSecret`, `test`, `unwrap`                                                                                                                |
| `webhooks.secrets`          | `list`, `retire`                                                                                                                                                                                        |
| `webhooks.deliveries`       | `list`, `get`, `retry`                                                                                                                                                                                  |
| `auditEvents`               | `list`                                                                                                                                                                                                  |
| `featureFlags`              | `list`                                                                                                                                                                                                  |
| `me`                        | `get`                                                                                                                                                                                                   |
| `health`                    | `check`                                                                                                                                                                                                 |

The SDK covers every operation an API key can call. Organizations, projects, members and API keys are managed in the web app. The full API is documented at [docs.nohead.io](https://docs.nohead.io).

## Development

```bash
npm install          # also builds dist/
npm test             # unit and contract tests
npm run lint && npm run typecheck && npm run typecheck:smoke && npm run format:check
npm run generate     # after updating openapi.json
npm run samples      # after changing test/calls.ts (the docs' code samples)
NOHEAD_API_URL=http://localhost:3000 NOHEAD_API_KEY=nohead_sk_… npm run smoke
```

Before pushing, also check that the generated code and the samples are current, as CI does:

```bash
npm run generate && npm run samples && git diff --exit-code src/generated samples.json
```

The unit tests' mock client (`mockClient` in `test/helpers.ts`) checks every request to the API, and every reply to one, against `openapi.json`, and fails the test on a mismatch; build replies from the contract's examples (`exampleOf`), and mark one that breaks the contract on purpose with `raw()`.

**How the code is organized:**

- `openapi.json` is the API's published contract. `npm run generate` derives two things from it:
  - the types, in `src/generated/types.gen.ts` (hey-api)
  - the operation table, in `src/generated/operations.gen.ts`
- The methods in `src/resources` are written by hand.
- `test/contract.test.ts` calls every public method. It fails when an API-key operation in the contract has no method, when a query parameter is never sent (no method takes it, or no call passes it), or when a request doesn't match its operation (method, path, query parameters and JSON body, against their schemas). Each call gets an example of its operation's response, built from the contract's schema, and must return it.

The smoke test (`smoke/smoke.ts`) runs the core flow against a real API, using the built package. Nohead's own CI runs it on every API contract change.

## Releasing

1. Bump the version in `package.json` and `src/version.ts`.
2. Add a section for it to `CHANGELOG.md` (`## 1.2.3`), which becomes the release's notes.
3. Merge to `main`. Its ruleset requires the **CI passed** check, so the commit goes through a pull request or a branch whose CI passed, and force pushes are refused.
4. Run the **SDK release** workflow in the Nohead API repository. It runs this commit's smoke test against the API and pushes the tag `v1.2.3`. Nobody else can push `v*` tags: a tag ruleset lets only that workflow's deploy key through.
5. The tag starts `.github/workflows/release.yml`. A build job checks the tag is on `main` and matches the version and its notes, and packs the package, with no publishing credential. Its publishing job runs in the `release` environment, which only `v*` tags can use, and the registry's trusted publisher accepts only that environment. It stages that package on npm with provenance through trusted publishing (no token), then creates a draft GitHub release.
6. Approve the staged version with 2FA, on npmjs.com, or with `npm stage list @nohead/sdk` and `npm stage approve <stage-id>`. Only then is it installable. Publish the draft GitHub release.

## License

MIT
