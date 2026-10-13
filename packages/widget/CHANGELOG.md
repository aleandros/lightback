# @lightback/widget

## 0.2.0

### Added

- `@lightback/widget/lazy` (`mountLazyWidget()`) and a lazy standalone script that load the editor and picker on first interaction while collectors keep running. Custom triggers, strings, themes and host styling are preserved; concurrent activations share one load, closing or destroying cancels a pending activation, and failed native imports retry with a fresh asset URL. The eager `mountWidget()` and standalone bundle remain available.
- Restore report text, selections, in-progress selection notes and opted-in screenshot/crop blobs after reload. The lazy trigger shows recovered counts before the UI loads; restored reports stay editable and never resume a pending send.
- Mask sensitive elements in every screenshot and crop with opaque boxes before preview, storage or send, measuring them before and after capture; images that cannot be masked are dropped. A **Hide area** pick-bar mode adds reporter masks that repaint current images, re-cut crops, apply to later captures and survive reload. Withheld selections are marked in their cards. New strings: `maskMode`, `maskHint`, `maskedLabel`, `sensitiveContent`.

### Changed

- Peer range on `@lightback/core` now covers the compatible 0.2 API; older core versions keep memory-only operation.

### Fixed

- Selection crop thumbnails keep their natural proportions: wide, tall and small region crops are no longer stretched or enlarged to the panel width, and high-DPR crops preview at on-page size. Exported crop images are unchanged.
- Region selection no longer skips page elements covered by existing pins.
- Sends discarded or destroyed while waiting for screenshot/crop jobs are cancelled, late capture jobs cannot revive a discarded draft, and late transport callbacks are ignored for invalidated widgets.

## 0.1.1

### Patch Changes

- 9af2a67: Add partial UI translations through `strings` and exported `defaultStrings`, explicit light/dark/auto themes, `hideTrigger` for custom controls, and styling parts for the pill, panel, popover and pending card. Keep `triggerLabel` as a supported alias for `strings.pillOpen`.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
