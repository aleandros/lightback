# @lightback/widget

## 0.2.0

### Minor Changes

- d488e50: Mark sensitive elements with `data-lightback-sensitive` or `privacy.selectors`. Selections, region children, breadcrumbs, previews, prompts and recovery records keep their selector and component names but withhold text, attributes, HTML and component props, and are flagged `sensitive`. Invalid privacy selectors throw.

  The widget masks sensitive elements in every screenshot and crop with opaque boxes before anything is previewed, stored or sent, and drops an image it cannot mask. Reporters can hide any other area from the pick bar; earlier crops are re-cut and later captures reuse the mask. Payloads list masks in an optional `masks` field when images are attached. Region selection now sees elements under existing pins.

- e9742b6: Restore bounded, redacted collector buffers and unfinished drafts after reload using session-scoped IndexedDB. Add expiry/schema handling, a storage opt-out, custom-editor recovery APIs, and explicit opt-in for privacy-safe screenshot/crop blobs. Clear drafts and old context after successful send or discard; keep the editor usable if storage is unavailable.

  Restore widget notes and selections without resuming pending sends. Show recovered counts before the lazy UI loads and guard late screenshot jobs after discard or teardown. Exclude form values from inspection snapshots and persisted metadata. Support the compatible core 0.2 API in widget and React peer ranges, retaining memory-only operation with older core versions.

### Patch Changes

- b12d7be: Add a lightweight `@lightback/widget/lazy` entry and lazy standalone script that load the editor and picker on first interaction. Preserve collectors, customization and host identity, coalesce concurrent activation, cancel pending activation on close/destroy, and retry failed native imports with a fresh asset URL.

  The React provider now mounts the lazy trigger by default. Its handle exposes promise-returning `open()` and `startPicking()` methods. The eager `mountWidget()` and standalone bundle remain available.

- 7d91479: Fix recovery and send races found by generated stateful tests: clear wins over a pending database open, recovered timestamps are sorted before applying smaller buffer limits, metadata-only recovery drops orphaned crop references, and tiny string limits preserve recovery field names. Cancel widget sends discarded or destroyed while waiting for image jobs and ignore late transport callbacks for invalidated widgets.

## Unreleased

### Added

- Restore report text, selections, in-progress selection notes and opted-in screenshot/crop blobs after reload. Show recovered counts in the lazy trigger, keep restored reports editable without restarting send timers, and prevent late capture jobs from reviving discarded drafts.
- Mask sensitive elements in every screenshot and crop with opaque boxes before preview, storage or send, measuring them before and after capture; drop images that cannot be masked. Add a **Hide area** pick-bar mode for reporter masks that repaint the current images, re-cut crops, apply to later captures and survive reload. Mark withheld selections in their cards. New strings: `maskMode`, `maskHint`, `maskedLabel`, `sensitiveContent`.

### Changed

- Add `mountLazyWidget()` through `@lightback/widget/lazy` and a lazy standalone script that load the editor and picker on first interaction while collectors keep running. Preserve custom triggers, strings, themes and host styling; share concurrent loads, retry failed downloads and prevent late mounting after teardown. The eager entry remains available.

### Fixed

- Region selection no longer skips page elements covered by existing pins.

## 0.1.1

### Patch Changes

- 9af2a67: Add partial UI translations through `strings` and exported `defaultStrings`, explicit light/dark/auto themes, `hideTrigger` for custom controls, and styling parts for the pill, panel, popover and pending card. Keep `triggerLabel` as a supported alias for `strings.pillOpen`.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
