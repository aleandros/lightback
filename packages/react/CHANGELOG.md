# @lightback/react

## 0.2.0

### Changed

- `LightbackProvider` now mounts the lazy widget by default: a lightweight trigger first, with the editor and picker loaded on first interaction. `useLightbackWidget()` returns a handle whose `open()` and `startPicking()` return promises. Mount-time customization, SSR safety and cleanup during loading are preserved.
- Requires `@lightback/widget` 0.2 (for the lazy entry). The `@lightback/core` peer range covers the compatible 0.2 API.

### Added

- Session recovery through the default lazy widget, including recovered counts on the trigger and editable reports after reload.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
