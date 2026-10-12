# @lightback/widget

## Unreleased

### Changed

- Add `mountLazyWidget()` through `@lightback/widget/lazy` and a lazy standalone script that load the editor and picker on first interaction while collectors keep running. Preserve custom triggers, strings, themes and host styling; share concurrent loads, retry failed downloads and prevent late mounting after teardown. The eager entry remains available.

## 0.1.1

### Patch Changes

- 9af2a67: Add partial UI translations through `strings` and exported `defaultStrings`, explicit light/dark/auto themes, `hideTrigger` for custom controls, and styling parts for the pill, panel, popover and pending card. Keep `triggerLabel` as a supported alias for `strings.pillOpen`.

## 0.1.0

### Minor Changes

- bc4530b: Prepare the initial 0.1.0 release with browser compatibility fallbacks, SSR-safe client creation, a standalone widget script, and separate ESM/CommonJS type exports. Include package documentation and the MIT license.
