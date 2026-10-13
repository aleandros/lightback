# @lightback/widget

## 0.2.2

### Fixed

- Large pages stay responsive while picking. Entering pick mode ran the capturer over the whole document, and DOM-cloning capturers freeze the page for time proportional to its size (25 seconds and a 23 MB PNG on a 93,000-element page). The automatic capture is now skipped, with a notice, when it would copy more than `screenshotMaxElements` elements (default 8000); the panel's Screenshot button still captures on request. New string: `screenshotSkipped`.
- Capturing no longer scrolls Safari to the top of the page when a widget control has focus. WebKit scrolls to the top when a focused element inside the fixed host is hidden. `domCapturer` leaves the widget out of the image so it no longer hides at all (the comment box keeps focus and keystrokes during a capture); with other capturers, focus leaves the widget for the capture and returns afterwards.

### Added

- `screenshotArea: 'viewport'` captures what is on screen instead of the whole page. A selection the first capture does not show (the page scrolled) gets its crop from a capture of the screen it was selected on, shared by other selections on that screen. Hiding an area over such a crop re-cuts it from a new capture.
- `domCapturer(render)` adapts `modern-screenshot`, `html-to-image` and similar DOM-cloning renderers. For a viewport area it copies only what is on screen, keeping off-screen elements as empty boxes so the layout does not move (content that overflows its box, as in `height: 100%` app roots, is still copied), and draws fixed elements where they are; sticky elements render unstuck. It leaves the widget out of the image: about 1 second and a few hundred KB on the same page. Exported from `@lightback/widget`, `@lightback/widget/lazy` and both standalone scripts.
- Screenshot and crop attachments record the document `area` they show; restored drafts use it to size crop previews and to repaint recovered screenshots under new hidden areas.

### Changed

- The capturer is called with `{ area }`, the document rect to capture. Whole-page capture stays the default, so capturers that ignore the argument keep working.

## 0.2.1

### Fixed

- Hovering an existing selection pin no longer leaves the page highlight on top of it, which buried the pin's number badge and ✕ under a tinted overlay. In pick mode the highlight clears as soon as the pointer moves onto widget UI (pins, popover, pick bar), and hovering a selection card in the panel lights up its pin instead of covering it.

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
