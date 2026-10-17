# Changelog

Changes to `@nohead/sdk` that you can notice. Versions follow
[Semantic Versioning](https://semver.org): additive API changes are minor
releases; a change that could break your code is a major one. Each release's
section is its GitHub release's notes.

## 0.3.0

- `changeNote` is sent percent-encoded (UTF-8), so change notes work in any
  language: a note outside ASCII used to fail the request.
- Drafts: changes to a record that wait until they are merged into it, now
  or at a set time. `drafts.create`, `list`, `get` (with `expand`, for
  previews), `update`, `discard`, `merge`, `schedule` and `unschedule`, and
  `records.drafts`. `records.publish` on a live record with a pending draft
  is a `ConflictError` (`draft_pending`). Webhook events gain `DraftEvent`
  (`draft.*`), and a merge's `record.updated` carries its `draft_id`.
- **Breaking:** the API is resource-oriented. Method names stay; what they
  return and take follows it:
  - Records have no `status`, `schedule` or `deleted`: a record is published
    when `published_at` is set, and has `deleted_at` and `purge_after`.
    Filter with `{ published_at: { exists: true } }`. `records.get` returns
    deleted records too (no `include_deleted`).
  - `records.schedule` and `unschedule` return the schedule, and
    `records.getSchedule`, `records.publication` and
    `records.scheduledChanges` are new. `records.bulk` returns a
    `record_batch`.
  - Project search takes `filter: { published_at: { exists: true } }`
    instead of `filter: { status }`.
  - Collections, fields, assets and webhooks have `deleted_at` and
    `purge_after` instead of `deleted`, and migrations
    `cancel_requested_at`.
  - `assets.createUpload` returns the asset with its `upload`.
  - `fields.reorder` returns the `field_order`; `fields.order` reads it.
  - Webhook event types are the activity log's actions (`record.restored`,
    `field.updated`, …, and wildcards such as `record.*`), and event
    payloads carry `actor` and `via`. `webhooks.rotateSecret` returns a
    `webhook_secret`; the old secret signs for 24 hours more.
    `webhooks.secrets.list`, `webhooks.secrets.retire` and
    `webhooks.restore` are new.
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
- `assets.purge()`: permanently deletes a deleted asset now, instead of 30
  days after the delete, and frees its storage.
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
  bytes again.
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
