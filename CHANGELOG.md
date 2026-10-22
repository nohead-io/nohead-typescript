# Changelog

Changes to `@nohead/sdk` that you can notice. Versions follow
[Semantic Versioning](https://semver.org): additive API changes are minor
releases; a change that could break your code is a major one. Each release's
section is its GitHub release's notes.

## Unreleased

- `assets.list({ q, kind })`: `q` finds assets whose filename or alt text
  has every word, ignoring case; `kind` lists only `image`, `video`,
  `audio`, `document` or `other` assets, or several kinds as a list.

- `assets.upload` types a file by its filename's extension when the Blob has
  no type, as Node's `openAsBlob` makes them: `cover.jpg` is now an
  `image/jpeg` asset, not `application/octet-stream`.

## 0.6.0

- API keys now start `nohead_sk_`, or `nohead_pk_` for published-only keys;
  keys in the old `sk_live_` format no longer work. The SDK sends whatever key
  it's given, so only the docs and examples change.

- `assets.update(asset, { filename?, alt? })` renames an asset and sets its
  alt text (`PATCH /v1/assets/{asset_id}`). `Asset` has `alt` (a string or
  `null`), and webhooks can subscribe to `asset.updated`.

- Image URLs are open. `Asset` has `image_url`, the whole image, and
  `imageUrl` from the new `@nohead/sdk/images` (no dependencies) writes any of
  imgproxy's processing options into it, without a request. It also has
  loaders for Next.js (`nextImageLoader`), Astro (`astroImageService`) and
  Nuxt Image (`nuxtImageProvider`, or `getImage` on Nuxt Image 1), which leave
  other images as they are.

- **Breaking:** `assets.imageUrl` is gone, with the API's
  `GET /v1/assets/{asset_id}/image-url`: use `imageUrl` from
  `@nohead/sdk/images`, which needs no request.

- **Breaking:** `Collection` has no `search_enabled`, and `SearchIndex` no
  `enabled`: API keys search every collection they can read.

- `revisions.get(revision)` reads a revision by its own `rev_` ID, as
  webhooks and the activity log name it (`GET /v1/revisions/{revision_id}`).

- `records.create` takes `upsert_on`, a unique field's key: the record
  holding that value is updated instead, if one exists, and `ifMatch`
  applies to that update.

- Collections have `public_search`: whether the project's search tokens find
  their published records. Off by default; `collections.create` and
  `collections.update` take it. A collection's search index has `index`, the
  name a token searches it by.

## 0.5.0

- **Breaking:** field migrations are created under their collection:
  `migrations.create(collection, { field_id, ...changes, dry_run? })`
  (`POST /v1/collections/{collection_id}/migrations`) replaces
  `fields.migrate(field, ...)`. It returns a preview for a dry run and the
  `FieldMigration` otherwise, as before. `FieldMigrateParams` is
  `MigrationCreateParams`, with `field_id`.
- **Breaking:** `drafts.list` no longer takes `record_id`; a record's drafts
  are `records.drafts(record)`.
- **Breaking:** `assets.list`'s `content_type` is one MIME type or `type/*`
  wildcard as a string, or several as a list (sent as
  `filter[content_type][in]`). A comma-separated string no longer lists
  several types: pass a list.
- **Breaking:** `auditEvents.list` sorts by `created_at` or `-created_at`
  (the default), not `id`, and records no longer sort by `id`.
- Webhook events always carry `actor` and `via` (now required in
  `WebhookEventPayload`), and `Via` no longer has `import` or `migration`,
  which were never sent.

## 0.4.0

- **Breaking:** a field's `api_key` is its `key` (in fields, their aliases,
  `fields.create` and `fields.update`), as the editor's "Field key" says.
  API keys keep their name.
- **Breaking:** `collections.schemaChanges.get(schemaChange)` takes the
  schema change's ID alone (`GET /v1/schema-changes/{id}`).
- **Breaking:** `fields.update` no longer takes `type` or `multiple`; they
  rewrite record values, so they are `fields.migrate`. The API refuses a
  body key an operation doesn't take with `400` (`unknown_parameter`, naming
  it), so a misspelt key no longer passes unnoticed.
- `Field` and `FieldCreate` are typed per field type: narrowing on
  `field.type` types its `configuration` (`if (field.type === "enum")
field.configuration.options`), and `EnumFieldConfiguration`,
  `RelationFieldConfiguration`... are exported.

## 0.3.0

- **Breaking:** 0.1.0 and 0.2.0 no longer work with the API: its paths and
  shapes changed (below), so upgrading is required.
- `changeNote` is sent percent-encoded (UTF-8), so change notes work in any
  language: a note outside ASCII used to fail the request.
- Drafts: changes to a record that wait until they are merged into it, now
  or at a set time. `drafts.create`, `list`, `get` (with `expand`, for
  previews), `update`, `discard`, `merge`, `schedule` and `unschedule`, and
  `records.drafts`. Drafts take the type of their data as records do
  (`drafts.get<Post>(id)` is a `NoheadDraft<Post>`, also `Nohead.Draft`),
  and `drafts.create(record)` needs no params to start from the record's
  values. `records.publish` on a live record with a pending draft is a
  `ConflictError` (`draft_pending`). Webhook events gain `DraftEvent`
  (`draft.*`), and a merge's `record.updated` carries its `draft_id`.
- **Breaking:** request options follow what each operation takes, by type:
  `changeNote` only on writes that change records or the schema
  (`WriteOptions`: record writes, `drafts.merge`, collection and field
  writes), not on assets, webhooks, schedules, search index rebuilds or
  other draft writes, which never kept a note. `ifMatch` on
  `records.update`, `delete`, `restore` (new), `publish`, `unpublish` and
  `revisions.revert` (`ConditionalWriteOptions`) and on `drafts.update`,
  `discard` and `merge`. `ConditionalRequestOptions` no longer includes
  `changeNote`.
- **Breaking:** `records.schedule` sets the whole schedule: a time left out
  is cleared (it used to keep its value), and `{}` clears both, as
  `unschedule` does.
- `fields.get()`: one field by ID.
- **Breaking:** the types for what only the web app can do (organizations,
  projects, members and invitations, billing, API keys, usage, account
  changes and redaction, such as `Organization`, `Project`, `ApiKey`, `Billing`) are gone. Those
  operations need a signed-in person, so an API key could never call them,
  and the API reference no longer lists them.
- **Breaking:** the API is resource-oriented. Method names stay; what they
  return and take follows it:
  - Records have no `status`, `schedule` or `deleted`: a record is published
    when `published_at` is set, and has `deleted_at` and `purge_after`.
    Filter with `{ published_at: { exists: true } }`. `records.get` returns
    deleted records too (no `include_deleted`).
  - `records.schedule` and `unschedule` return the schedule, and
    `records.getSchedule`, `records.publication` and
    `records.scheduledChanges` are new. `records.bulk` returns a
    `record_batch`: `BulkRecordsResult` and `BulkRecordsRequest` are now
    `RecordBatch` and `RecordBatchRequest`.
  - Project search takes `filter: { published_at: { exists: true } }`
    instead of `filter: { status }`.
  - Collections, fields, assets and webhooks have `deleted_at` and
    `purge_after` instead of `deleted`, and migrations
    `cancel_requested_at`.
  - `assets.createUpload` returns the asset with its `upload`
    (`AssetWithUpload`, was `AssetUpload`).
  - `fields.reorder` returns the `field_order`; `fields.order` reads it.
  - Webhook event types are those of the activity log (`record.restored`,
    `field.updated`, …, and wildcards such as `record.*`), and event
    payloads carry `actor` and `via`. `SchemaChangedEvent`
    (`schema.changed`) is now `SchemaEvent` (`collection.*` and `field.*`,
    with the `collection`, its `object`, the `schema_change` and, for a
    field, its `field_id`), and `FieldAliasRemovedEvent` is new
    (`field.alias_removed`). There is no `record.imported`. The event data
    types are exported too (`RecordEventData`, `DraftEventData`,
    `AssetEventData`, `SchemaEventData`, `FieldAliasEventData`,
    `WebhookTestEventData`).
  - `webhooks.rotateSecret` returns a `webhook_secret`
    (`WebhookSecretWithValue`, was `WebhookWithSecret`); the old secret
    signs for 24 hours more. `webhooks.secrets.list`,
    `webhooks.secrets.retire`, `webhooks.restore` and
    `webhooks.list({ deleted })` are new. `webhooks.deliveries.retry`
    calls the API's new path.
  - Audit events are `object: "event"`, and name what happened in `type`
    (was `action`). `auditEvents.list` filters by `type`, `resource_type`
    (one, or a list of them), `resource_id`, `actor_type`, `actor_id` and
    `created_at: { gte, gt, lte, lt }` (was `action`, `since` and
    `until`); an unknown filter is an `InvalidRequestError`. Field events
    have the resource type `field`.
  - `records.revisions.list` filters `created_at` by range (was `since`
    and `until`), and revisions' `operation` can be `merge` (not `import`).
  - `ScheduledChange` has no `last_error`, and `SchemaChange` no `status`.
    `ChangeVia` is gone: `Via` names the client a change came through.
  - Exported types for the params that were inline:
    `ScheduledChangeListParams`, `DraftScheduleParams`,
    `FieldReorderParams`, and the filters `AuditEventFilter`,
    `RevisionFilter` and `TimeRange`.
- **Breaking:** the `datetime` field type is now `date`. A plain date field holds
  `YYYY-MM-DD`; with `include_time` it holds a moment, written in the field's
  `time_zone` when it has one. Field migrations take `time_zone`, the zone
  whose day each moment falls on when the time is removed.
- Boolean fields can't be `required`: a boolean is true or false, and no
  value reads as false.
- Text fields take a `format` (`email`, `url`, `slug`; slugs are always
  unique) and text and integer fields `unique`; a taken value's error detail
  has the `record_id` that has it (`code: "taken"`).
- Filters take operators: `{ price: { lt: 50 } }`, with `eq`, `ne`, `gt`,
  `gte`, `lt`, `lte`, `in` (a list) and `exists`, and record lists sort by a
  field's value. Commas and backslashes in list values are escaped, so a
  value can hold a comma.
- Date filters take `today`, and dates with a time `now`.
- `assets.usage()`: where an asset is used, as counts of the records that use
  it (and of those, the published ones) and the 10 most recently updated with
  the fields that use it. Needs the `records:read` scope too.
- `assets.purge()`: permanently deletes a deleted asset now, instead of at
  its `purge_after`, and frees its storage.
- An error reads only the fields of the API's error envelope that have the
  right type, so JSON from a proxy or gateway that merely looks like one no
  longer gives it a non-string `message`, `type` or `requestId`.
- `APIError.type` is typed as the known error types or any string: the API
  can add types, and one newer than the SDK is kept as is. Code that checks
  it exhaustively needs a default branch.
- An error whose type names a built-in property (`constructor`,
  `toString`) is an `APIError`; it used to throw a value that wasn't one.
- An error's `details` keep only entries that are objects, so
  `currentRevision` no longer throws on a `null` one.

## 0.2.0

- `onRetry` client option: called before each retry with the attempt, the
  delay, and the status or error that failed, for example to report retries.
- `assets.upload()` with an `idempotencyKey` no longer fails when it
  completes the upload: the key only starts it. Running the same upload again
  resumes it, and returns an asset that is already `ready` without sending the
  bytes again; once the upload's URL has expired it throws `UploadError`
  (start over with a new key).
- Types follow the API's current contract. They add types only for
  operations an API key can't call, so no method changed.

## 0.1.0

The first release.

- `new Nohead()`, with methods for every operation an API key can call:
  records (with revisions, scheduling, bulk changes and search), collections,
  fields and migrations, assets, webhooks and their deliveries, the audit
  log, feature flags.
- Lists you can `await` for one page or `for await` across every page.
- Typed errors per API error type, retries with idempotency keys, `ifMatch`
  and change notes, `withResponse()`.
- `assets.upload()` in one call, and webhook verification
  (`webhooks.unwrap()`, or `@nohead/sdk/webhooks` without a client).
