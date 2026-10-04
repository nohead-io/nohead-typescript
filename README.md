# Nohead TypeScript SDK

The official TypeScript client for the [Nohead](https://nohead.io) API: typed records, pagination you can loop over, retries that are safe for writes, one-call uploads and webhook verification. No runtime dependencies.

```ts
import { Nohead } from "@nohead/sdk"

const nohead = new Nohead() // reads NOHEAD_API_KEY

for await (const post of nohead.records.list("posts", {
  filter: { status: "published" },
})) {
  console.log(post.data.title)
}
```

> **Status:** 0.x, not yet published to npm. Until it is, install from GitHub: `npm install github:nohead-io/nohead-typescript`.

## Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Records](#records)
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

The package is ESM; Node 22+ can also `require()` it. It runs on Node 22, 24 and 26, Bun, Deno, Cloudflare Workers and other runtimes with `fetch` and Web Crypto. Use it on servers: API keys are secrets.

## Configuration

```ts
const nohead = new Nohead({
  apiKey: process.env.NOHEAD_API_KEY, // default: NOHEAD_API_KEY
  baseUrl: "https://api.nohead.io", // default: NOHEAD_API_URL, else production
})
```

| Option       | Default                                        |                                                      |
| ------------ | ---------------------------------------------- | ---------------------------------------------------- |
| `apiKey`     | `NOHEAD_API_KEY`                               | A project API key (`sk_live_…`). Required.           |
| `baseUrl`    | `NOHEAD_API_URL`, else `https://api.nohead.io` |                                                      |
| `projectId`  | the key's project                              | Looked up once with `GET /v1/me` when omitted.       |
| `maxRetries` | `2`                                            | See [retries](#retries-and-idempotency).             |
| `timeout`    | `60000`                                        | Milliseconds per attempt.                            |
| `fetch`      | `globalThis.fetch`                             | For proxies, instrumentation and tests.              |
| `headers`    | `{}`                                           | Added to every request.                              |
| `warnings`   | `true`                                         | Logs deprecation and plan usage warnings, once each. |

API keys belong to a project, so methods like `collections.list()` need no project ID. Collections can be named by ID or slug everywhere.

## Records

```ts
const draft = await nohead.records.create("posts", {
  data: { title: "Hello", author: "rec_01J9…" },
})
const post = await nohead.records.get(draft.id, { expand: ["author"] })
await nohead.records.update(post.id, { data: { title: "Hello again" } })
await nohead.records.publish(post.id)
await nohead.records.schedule(post.id, { unpublish_at: new Date("2027-01-01") })
await nohead.records.delete(post.id) // soft delete; records.restore() undoes it
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

**More:** `count`, `bulk` (up to 100 records at once), `diff`, `revisions.list`, `revisions.get` and `revisions.revert` (with `{ dry_run: true }` for a preview).

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

Filters are equality filters (for fields with several values: "contains"), and accept strings, numbers, booleans and dates:

```ts
nohead.records.list("posts", {
  filter: { status: "published", featured: true, author: "rec_01J9…" },
  sort: "-published_at",
  expand: ["author", "tags"],
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
- `ifMatch` (record writes)
- `changeNote`, a reason shown in history
- `signal`, `timeout`, `maxRetries` and `headers`

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

`ifMatch` takes a record or a revision number, on `update`, `delete`, `publish`, `unpublish` and `revisions.revert`.

## Assets

```ts
import { openAsBlob } from "node:fs"

const asset = await nohead.assets.upload(await openAsBlob("cover.jpg"), {
  filename: "cover.jpg",
})
await nohead.records.update(id, { data: { cover: asset.id } })

const { url } = await nohead.assets.imageUrl(asset.id, {
  width: 1200,
  format: "webp",
})
```

**What `upload` accepts:** a `Blob`, `File`, `ArrayBuffer`, `Uint8Array`, or a `ReadableStream` with `byte_size`.

**What it does:**

1. Creates the upload.
2. Sends the bytes straight to storage.
3. Completes the upload, which checks the file, and returns the `ready` asset.

**Errors:** `UploadError` if storage refuses the bytes; `ValidationError` if the file fails the checks.

**Uploading from a browser:** create the upload on your server with `createUpload`, `PUT` the file from the browser, then `complete` it.

## Search

```ts
// One collection
for await (const hit of nohead.records.search("posts", "content model")) { … }

// Across the project
const results = await nohead.search("content model", { collections: ["posts", "pages"] })
results.meta.total_estimate
```

Search needs `search_enabled` collections and the `search:read` scope. It pages through the first 1,000 hits.

## Schema

```ts
const posts = await nohead.collections.create({
  name: "Posts",
  slug: "posts",
  fields: [{ name: "Title", api_key: "title", type: "text", required: true }],
})
await nohead.fields.create("posts", {
  name: "Summary",
  api_key: "summary",
  type: "long_text",
})

// Changes that rewrite records go through a migration; preview first
const preview = await nohead.fields.migrate("fld_…", {
  type: "long_text",
  dry_run: true,
})
const migration = await nohead.fields.migrate("fld_…", { type: "long_text" })
await nohead.migrations.get(migration.id)
```

For schema as code, see the `nohead` CLI (`nohead schema pull/diff/push`).

## Webhooks

Verify a webhook request, then use its event:

```ts
// e.g. a Next.js route handler
export async function POST(request: Request) {
  const event = await nohead.webhooks.unwrap(
    await request.text(),
    request.headers,
    {
      secret: process.env.NOHEAD_WEBHOOK_SECRET!,
    }
  )
  if (event.type === "record.published") {
    revalidateTag(event.data.record.collection)
  }
  return new Response(null, { status: 204 })
}
```

`unwrap` checks the signature and the timestamp (Standard Webhooks), and throws `WebhookVerificationError` if either is off. Pass the raw body: parsing and re-serializing JSON changes the bytes.

A receiver that never calls the API can use `unwrapWebhook` from `@nohead/sdk/webhooks` without a client. Events can arrive more than once, so deduplicate by the `webhook-id` header.

## Raw responses

```ts
const { data, response, requestId } = await nohead.records
  .get(id)
  .withResponse()
response.headers.get("RateLimit-Remaining")
```

## Reference

| Resource                    | Methods                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `records`                   | `list`, `get`, `create`, `update`, `delete`, `restore`, `publish`, `unpublish`, `schedule`, `unschedule`, `count`, `bulk`, `diff`, `search` |
| `records.revisions`         | `list`, `get`, `revert`                                                                                                                     |
| `search`                    | across the project                                                                                                                          |
| `collections`               | `list`, `get`, `create`, `update`, `delete`, `restore`, `schema`                                                                            |
| `collections.schemaChanges` | `list`, `get`                                                                                                                               |
| `collections.searchIndex`   | `get`, `rebuild`                                                                                                                            |
| `fields`                    | `list`, `create`, `update`, `delete`, `restore`, `reorder`, `removeAlias`, `migrate`                                                        |
| `migrations`                | `list`, `get`, `cancel`                                                                                                                     |
| `assets`                    | `upload`, `createUpload`, `complete`, `list`, `get`, `delete`, `restore`, `imageUrl`, `downloadUrl`                                         |
| `webhooks`                  | `list`, `get`, `create`, `update`, `delete`, `rotateSecret`, `test`, `unwrap`                                                               |
| `webhooks.deliveries`       | `list`, `get`, `retry`                                                                                                                      |
| `auditEvents`               | `list`                                                                                                                                      |
| `featureFlags`              | `list`                                                                                                                                      |
| `me`                        | `get`                                                                                                                                       |
| `health`                    | `check`                                                                                                                                     |

The SDK covers every operation an API key can call. Organizations, projects, members and API keys are managed in the web app. The full API is documented at [docs.nohead.io](https://docs.nohead.io).

## Development

```bash
npm install          # also builds dist/
npm test             # unit and contract tests
npm run lint && npm run typecheck && npm run format:check
npm run generate     # after updating openapi.json
npm run samples      # after changing test/calls.ts (the docs' code samples)
NOHEAD_API_URL=http://localhost:3000 NOHEAD_API_KEY=sk_live_… npm run smoke
```

**How the code is organized:**

- `openapi.json` is the API's published contract. `npm run generate` derives two things from it:
  - the types, in `src/generated/types.gen.ts` (hey-api)
  - the operation table, in `src/generated/operations.gen.ts`
- The methods in `src/resources` are written by hand.
- `test/contract.test.ts` calls every public method. It fails when an API-key operation in the contract has no method, or when a request doesn't match its operation.

The smoke test (`smoke/smoke.ts`) runs the core flow against a real API, using the built package. Nohead's own CI runs it on every API contract change.

## Releasing

1. Bump the version in `package.json` and `src/version.ts`.
2. Add a section for it to `CHANGELOG.md` (`## 1.2.3`), which becomes the release's notes.
3. Merge to `main`. Its ruleset requires the **CI passed** check, so the commit goes through a pull request or a branch whose CI passed, and force pushes are refused.
4. Run the **SDK release** workflow in the Nohead API repository. It runs this commit's smoke test against the API and pushes the tag `v1.2.3`. Nobody else can push `v*` tags: a tag ruleset lets only that workflow's deploy key through.
5. The tag starts `.github/workflows/release.yml`. Its publishing job runs in the `release` environment, which only `v*` tags can use, and the registry's trusted publisher accepts only that environment. It checks the version and its notes, tests, and stages the package on npm with provenance through trusted publishing (no token). Then it creates a draft GitHub release.
6. Approve the staged version with 2FA, on npmjs.com, or with `npm stage list @nohead/sdk` and `npm stage approve <stage-id>`. Only then is it installable. Publish the draft GitHub release.

## License

MIT
