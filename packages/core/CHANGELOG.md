# @lightback/core

## 0.2.5

### Patch Changes

- Inspect elements in open shadow roots and same-origin frames with context paths, reporting-document coordinates, and privacy masking across nested boundaries. Add pointer and keyboard picking, frame-aware pins/crops, and guarded breadcrumb collection in accessible contexts.

## 0.2.4

### Patch Changes

- f7e2c1f: Add editable rectangle, arrow, ellipse/circle and text annotations to screenshots and crops, with a visual toolbar, drag-to-move and resize handles, keyboard controls, undo/reset, exact PNG previews, and editable recovery over masked originals.

## 0.2.3

### Patch Changes

- b7fbe95: Rank prompt evidence by failure priority and proximity to the latest captured interaction, with submission time as fallback. Collapse repeated evidence with counts and first/last timestamps without changing the payload. Add an exported PromptOptions type and a configurable overall character budget alongside the existing per-collector group limit, with explicit omission notices and no claims of causality.

## 0.2.2

### Patch Changes

- b6ba9b8: Add the optional @lightback/source build package with reusable JSX/TSX stamping, Vite and Babel adapters, project-relative paths, include/exclude controls and source maps. Apply identical options in client and SSR builds. Vue and Svelte templates retain the manual data-source fallback.

  Prefer explicit data-source locations over framework debug locations in core, preserving project-relative element locations from the build adapters.

## 0.2.1

### Added

- Image attachments can carry `area`, the document rect they show, so consumers can place selection `docRect`s on viewport screenshots and crops. It is kept through drafts, recovery, the payload and the transport only as four finite numbers with a positive size, and `toPromptContext` lists it. Payload `version` stays 1; a `screenshot.png` without `area` still covers `page.size`.

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
