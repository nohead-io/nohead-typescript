# Changelog

Changes to `@nohead/sdk` that you can notice. Versions follow
[Semantic Versioning](https://semver.org): additive API changes are minor
releases; a change that could break your code is a major one. Each release's
section is its GitHub release's notes.

## Unreleased

- `onRetry` client option: called before each retry with the attempt, the
  delay, and the status or error that failed, for example to report retries.
- `assets.upload()` with an `idempotencyKey` no longer fails when it
  completes the upload: the key only starts it. Running the same upload again
  resumes it, and returns an asset that is already `ready` without sending the
  bytes again.

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
