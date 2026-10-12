# Roadmap

Status as of 2026-10-12. Items are ordered by agreed priority within each tier. Move an item to "Done" with the date and a one-line pointer when it ships, and keep README's Roadmap section in step.

## Done (v0)

- Collectors: console, errors, network (fetch + XHR, opt-in same-origin bodies), breadcrumbs, env; ring buffers and limits.
- Redaction defaults applied over the whole payload.
- Element picker with component chain (React, Vue), unique selectors, source location and props snapshot.
- Drag-rectangle region selection that respects stacking (modal over table).
- Inline comment popover, numbered pins with remove, pill with direct actions, pickbar with Cancel/Done.
- Automatic full-page screenshot plus per-selection outlined crops.
- Optimistic send with a cancel window, Edit/Cancel/Discard, panel with Prompt/JSON review.
- JSON/multipart transport, `beforeSend`, custom `send`, `toPromptContext`.
- React provider and hooks. Playground with mock API and inbox. Four browser suites plus unit tests.

## Done (2026-10-12)

- Track A repository implementation: UUID/screenshot fallbacks, SSR-safe creation, repeated-mount coverage, ES2020 and standalone IIFE, proper ESM/CommonJS types. CI and Changesets release workflows are implemented and passing. See `docs/HANDOFF.md`.

- Published `@lightback/core`, `@lightback/widget` and `@lightback/react` at `0.1.0`; configured trusted publishing for all three and merged release PR #1.

## In flight (see `docs/HANDOFF.md` for steps)

- Track A: verify the first actual OIDC upload on the next Version Packages PR. The `0.1.0` bootstrap is published, trusted publishers are configured, and GitHub CI/Release checks pass.
- Track B: website at https://aleandros.github.io/lightback with screenshots, clips and the guides (VitePress on `docs/`).
- Track C: user guides in `docs/guide/` plus the small widget APIs they promise (`strings`, `theme`, `hideTrigger`, `::part`).

## Next (agreed, not started)

1. **Correlation and ranking in the prompt.** `toPromptContext` should surface the errors and failed requests that happened closest to the selection or the last user action first, and collapse repetitive noise. Pure function in `prompt.ts`, test with fixtures.
2. **Reference triage handler.** A small server example (Node) that receives the multipart payload, calls a model with `toPromptContext` plus the screenshot, and returns a structured triage (summary, suspected component, severity). Publish the payload JSON Schema alongside, generated from `types.ts`.
3. **Vite plugin that stamps `data-source`.** Adds `data-source="file:line:col"` to JSX/Vue/Svelte elements at build time so production bundles keep source locations without React debug internals. Lives in a new `packages/vite-plugin`.
4. **Screenshot annotations.** Rectangles, arrows and a blur tool on the captured screenshot, so sensitive regions can be masked before sending.
5. **Persistence.** Keep ring buffers and the current draft in `sessionStorage` so a reload mid-report, or an error that reloads the page, does not lose context.
6. **Lazy widget.** Load the widget on first pill interaction. (The IIFE build and CI moved into Track A.)

## Later

- Voice notes with a pluggable transcriber (`note.transcript` already exists in the payload).
- Short video capture via `getDisplayMedia`.
- Optional rrweb plugin with a rolling replay window.
- Vue and Svelte wrappers mirroring `@lightback/react`.
- Keyboard navigation in pick mode; shadow-root and iframe piercing in the host app.
- Re-capture the base screenshot when selections are made after the page changed.

## Open questions

License is settled: the SDK packages are MIT (see `docs/DECISIONS.md` #12). A hosted backend, if built, is a separate codebase under its own terms.

- Public API freeze point for `FeedbackPayload` v1. Decide before publishing to npm.
- npm scope is settled: `@lightback/*`, owned by the `lightback` organization. Initial `0.1.0` packages published on 2026-10-12.
