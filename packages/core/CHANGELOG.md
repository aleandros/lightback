# @lightback/core

## 0.2.0

### Added

- Session recovery: restore bounded, redacted collector buffers and unfinished drafts after reload through session-scoped IndexedDB (default maximum age 30 minutes). Includes expiry and schema checks, custom-editor recovery APIs, `clearPersistence()`, a storage opt-out, and an explicit `persistence.attachments` opt-in for masked screenshot/crop blobs. Successful send and Discard clear the draft and old buffers; denied or full storage leaves the client usable.
- Sensitive content: mark subtrees with `data-lightback-sensitive` or `privacy.selectors`. Selections, region children and breadcrumbs keep selectors and component names but withhold text, classes, attributes, HTML and the props of components that render sensitive content, and carry `sensitive: true`. Matching uses the live DOM; invalid selectors throw. Adds `client.isSensitive()`, `client.sensitiveRects()`, `SENSITIVE_ATTR`, draft `masks`, and an optional payload `masks` field (present when images are attached, rendered by `toPromptContext`). Payload `version` stays 1.

### Fixed

- Redact the complete payload, including page metadata, context, breadcrumbs and embedded URLs/JSON, and keep attachment names consistent with redacted references.
- Exclude form-control values and editable contents from inspected text, HTML, props, breadcrumbs and persisted metadata.
- Omit redirected response bodies unless the final origin is verified as same-origin.
- Late network completions no longer refill cleared or destroyed clients; destroying several clients in any order keeps the others' collectors running.
- Recovery races found by stateful property tests: clear wins over a pending database open, recovered events are sorted before smaller buffer limits apply, metadata-only recovery drops orphaned crop references, and tiny string limits keep recovery field names.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
