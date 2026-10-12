# @lightback/core

## Unreleased

### Added

- Add session-scoped IndexedDB recovery for redacted collector buffers and drafts, bounded retention, blob opt-in, custom-editor recovery APIs and a storage opt-out. Clear recovery and old buffers on successful send or explicit discard; tolerate denied/quota storage and invalid schemas. Exclude form-control values from inspected text, HTML and props.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
