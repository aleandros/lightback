# @lightback/core

## 0.2.0

### Minor Changes

- d488e50: Mark sensitive elements with `data-lightback-sensitive` or `privacy.selectors`. Selections, region children, breadcrumbs, previews, prompts and recovery records keep their selector and component names but withhold text, attributes, HTML and component props, and are flagged `sensitive`. Invalid privacy selectors throw.

  The widget masks sensitive elements in every screenshot and crop with opaque boxes before anything is previewed, stored or sent, and drops an image it cannot mask. Reporters can hide any other area from the pick bar; earlier crops are re-cut and later captures reuse the mask. Payloads list masks in an optional `masks` field when images are attached. Region selection now sees elements under existing pins.

- e9742b6: Restore bounded, redacted collector buffers and unfinished drafts after reload using session-scoped IndexedDB. Add expiry/schema handling, a storage opt-out, custom-editor recovery APIs, and explicit opt-in for privacy-safe screenshot/crop blobs. Clear drafts and old context after successful send or discard; keep the editor usable if storage is unavailable.

  Restore widget notes and selections without resuming pending sends. Show recovered counts before the lazy UI loads and guard late screenshot jobs after discard or teardown. Exclude form values from inspection snapshots and persisted metadata. Support the compatible core 0.2 API in widget and React peer ranges, retaining memory-only operation with older core versions.

### Patch Changes

- 7d91479: Redact the complete payload, including page metadata, context, breadcrumbs and embedded URLs/JSON, and keep attachment filenames consistent with redacted references. Exclude editable contents from breadcrumb and inspection text. Omit redirected response bodies unless their final origin is verified as same-origin. Prevent late network completions from refilling cleared or destroyed clients, and preserve independent collectors when multiple clients are destroyed in any order.
- 7d91479: Fix recovery and send races found by generated stateful tests: clear wins over a pending database open, recovered timestamps are sorted before applying smaller buffer limits, metadata-only recovery drops orphaned crop references, and tiny string limits preserve recovery field names. Cancel widget sends discarded or destroyed while waiting for image jobs and ignore late transport callbacks for invalidated widgets.

## Unreleased

### Added

- Add session-scoped IndexedDB recovery for redacted collector buffers and drafts, bounded retention, blob opt-in, custom-editor recovery APIs and a storage opt-out. Clear recovery and old buffers on successful send or explicit discard; tolerate denied/quota storage and invalid schemas. Exclude form-control values from inspected text, HTML and props.
- Add `data-lightback-sensitive` and `privacy.selectors` for sensitive subtrees. Selections, region children and breadcrumbs keep selectors and component names but withhold text, classes, attributes, HTML and the props of components that render sensitive content; they carry `sensitive: true`. Matching uses the live DOM, so dynamic content is covered; invalid selectors throw. Add `client.isSensitive()`, `client.sensitiveRects()`, `SENSITIVE_ATTR`, draft `masks` (persisted and validated on recovery) and an optional payload `masks` field, present when images are attached and rendered by `toPromptContext`.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
