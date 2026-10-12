# @lightback/react

## Unreleased

### Added

- Support core session recovery through the default lazy widget, including recovered trigger counts and editable reports after reload. Widen the core peer range for the compatible 0.2 API.

### Changed

- Load the widget UI on first interaction by default. `LightbackProvider` initially mounts a lightweight trigger, and `useLightbackWidget()` exposes a lazy handle with promise-returning `open()` and `startPicking()` methods. Preserve mount-time customization, SSR safety and cleanup during loading.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
