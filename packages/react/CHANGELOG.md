# @lightback/react

## 1.0.0

### Minor Changes

- b12d7be: Add a lightweight `@lightback/widget/lazy` entry and lazy standalone script that load the editor and picker on first interaction. Preserve collectors, customization and host identity, coalesce concurrent activation, cancel pending activation on close/destroy, and retry failed native imports with a fresh asset URL.

  The React provider now mounts the lazy trigger by default. Its handle exposes promise-returning `open()` and `startPicking()` methods. The eager `mountWidget()` and standalone bundle remain available.

### Patch Changes

- e9742b6: Restore bounded, redacted collector buffers and unfinished drafts after reload using session-scoped IndexedDB. Add expiry/schema handling, a storage opt-out, custom-editor recovery APIs, and explicit opt-in for privacy-safe screenshot/crop blobs. Clear drafts and old context after successful send or discard; keep the editor usable if storage is unavailable.

  Restore widget notes and selections without resuming pending sends. Show recovered counts before the lazy UI loads and guard late screenshot jobs after discard or teardown. Exclude form values from inspection snapshots and persisted metadata. Support the compatible core 0.2 API in widget and React peer ranges, retaining memory-only operation with older core versions.

- Updated dependencies [b12d7be]
- Updated dependencies [d488e50]
- Updated dependencies [e9742b6]
- Updated dependencies [7d91479]
  - @lightback/widget@0.2.0

## Unreleased

### Added

- Support core session recovery through the default lazy widget, including recovered trigger counts and editable reports after reload. Widen the core peer range for the compatible 0.2 API.

### Changed

- Load the widget UI on first interaction by default. `LightbackProvider` initially mounts a lightweight trigger, and `useLightbackWidget()` exposes a lazy handle with promise-returning `open()` and `startPicking()` methods. Preserve mount-time customization, SSR safety and cleanup during loading.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
