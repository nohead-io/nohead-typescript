# Changelog

Changes to `@nohead/sdk` that you can notice. Versions follow
[Semantic Versioning](https://semver.org): additive API changes are minor
releases; a change that could break your code is a major one. Each release's
section is its GitHub release's notes.

## 0.3.0

- **Breaking:** the `datetime` field type is now `date`. A plain date field holds
  `YYYY-MM-DD`; with `include_time` it holds a moment, written in the field's
  `time_zone` when it has one. Field migrations take `time_zone`, the zone
  whose day each moment falls on when the time is removed.
- Boolean fields can't be `required`: a boolean is true or false, and no
  value reads as false.
- Text fields take a `format` (`email`, `url`, `slug`; slugs are always
  unique) and text and integer fields `unique`; a taken value's error detail has the `record_id` that has
  it (`code: "taken"`).
- Filters take operators: `{ price: { lt: 50 } }`, with `eq`, `ne`, `gt`,
  `gte`, `lt`, `lte`, `in` (a list) and `exists`, and record lists sort by a
  field's value. Commas and backslashes in list values are escaped, so a
  value can hold a comma.
- `assets.usage()`: where an asset is used, as counts of the records that use
  it (and of those, the published ones) and the 10 most recently updated with
  the fields that use it. Needs the `records:read` scope too.
- `assets.purge()`: permanently deletes a deleted asset now, instead of 30
  days after the delete, and frees its storage.

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
