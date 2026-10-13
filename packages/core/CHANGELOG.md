# @lightback/core

## Unreleased

### Added

- Add session-scoped IndexedDB recovery for redacted collector buffers and drafts, bounded retention, blob opt-in, custom-editor recovery APIs and a storage opt-out. Clear recovery and old buffers on successful send or explicit discard; tolerate denied/quota storage and invalid schemas. Exclude form-control values from inspected text, HTML and props.
- Add `data-lightback-sensitive` and `privacy.selectors` for sensitive subtrees. Selections, region children and breadcrumbs keep selectors and component names but withhold text, classes, attributes, HTML and the props of components that render sensitive content; they carry `sensitive: true`. Matching uses the live DOM, so dynamic content is covered; invalid selectors throw. Add `client.isSensitive()`, `client.sensitiveRects()`, `SENSITIVE_ATTR`, draft `masks` (persisted and validated on recovery) and an optional payload `masks` field rendered by `toPromptContext`.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
