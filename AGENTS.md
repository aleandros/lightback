# Lightback — guide for agents

Read this first. Then `docs/ARCHITECTURE.md` for how the pieces fit and `docs/DECISIONS.md` for why they are shaped this way. Pick work from the [GitHub backlog](https://github.com/aleandros/lightback/issues/19) and read the selected issue for scope, acceptance criteria and handoff notes. GitHub issues are the source of truth for priorities and progress; update the issue rather than maintaining source-controlled roadmap/handoff checklists. Keep architecture, decisions and user guides current when behavior changes.

User-facing guides live in `docs/guide/`. They are written ahead of the code in places; every such section is marked **Planned**. When you ship one of those features, remove the marker and update the prose in the same change.

## What this is

A framework-agnostic in-app feedback library. A user points at elements or drags an area, writes a note, and the widget sends a JSON payload (plus PNG attachments) with the context a developer or an AI model needs: component chain and source location per selection, console, errors, network, breadcrumbs, environment, app context. Backend-agnostic: `endpoint` or a custom `send`. There is no hosted service; the payload is the product.

## Layout

```
packages/core      @lightback/core    collectors, redaction, inspection, payload, transport. Zero deps. No DOM UI.
packages/widget    @lightback/widget  <lightback-widget> custom element, Shadow DOM, vanilla TS. Depends on core only.
packages/react     @lightback/react   LightbackProvider, useLightback, useLightbackWidget. Thin.
packages/vue       @lightback/vue     Vue lifecycle/context composables.
packages/svelte    @lightback/svelte  Svelte lifecycle/context helpers.
packages/source    @lightback/source  optional build-time JSX/TSX, Vue and Svelte stamping. No runtime dependency.
examples/playground                   Vite + React demo with a mock API (vite.config.ts) and an inbox page.
e2e                                   Playwright suites against the playground. Not unit tests.
docs                                  Architecture, decisions, user guides (docs/guide), screenshots (docs/assets).
```

Dependency direction is strict: `core ← widget ← react/vue/svelte`, `playground` consumes core/widget/react via Vite aliases to `src` (no build needed for `pnpm dev`).

## Commands

```bash
pnpm install
pnpm dev                     # playground at http://localhost:5173 (mock API included)
pnpm build                   # tsup, topological order; run before typecheck on a fresh clone
pnpm typecheck               # tsc across all projects (widget/react need core's dist for types)
pnpm test                    # vitest, packages/core/test
pnpm e2e       # browser suites; run build first; needs `pnpm dev` running and a system Chrome
pnpm e2e send-flow   # one suite
pnpm build:site       # docs + production demo, assembled for Pages
pnpm e2e:demo         # built static demo against a temporary HTTP server
pnpm screenshots     # regenerate docs/assets/*.png from the playground; needs `pnpm dev` running
```

Node 22, pnpm 10 via corepack. The e2e runner defaults to Playwright's `channel: 'chrome'`; set `CHROME=/path/to/binary` to override, `BASE_URL` to point elsewhere. `BROWSER=chromium|firefox|webkit` uses the installed Playwright engine and ignores `CHROME`. `pnpm check:packages` validates tarballs and strict type resolution; it needs npm registry access for a scratch install. Screenshots land in `e2e/out/<suite>/` (gitignored). Look at them when a suite fails: they are the fastest way to see what the widget actually rendered.

## Definition of done

A change is done when all of these hold. Report results plainly; if something fails, say so with the output.

1. `pnpm build` succeeds (all package modules/declarations plus standalone bundles).
2. `pnpm typecheck` is clean.
3. `pnpm test` passes (core and widget).
4. `pnpm e2e` passes all suites. For demo/site changes, `pnpm build:site` and `pnpm e2e:demo` also pass.
5. README and the relevant `docs/*.md` describe the new behaviour. A feature that is not in README does not exist for users.
6. New UI hooks have a `data-action` or `data-ref` attribute and the e2e suites use those, never visible text.

## Conventions that are easy to break

- **Widget UI lives in `packages/widget/src/ui.ts` as a template string plus a class.** Buttons dispatch through `data-action` handled in `onRootClick`. Query elements with `this.q('[data-ref=…]')`. No framework in the widget; it must stay usable from any host.
- **Everything the widget renders carries `data-lightback-ignore`** (the host element has it). Core's `isIgnored` and the picker's hit testing skip anything inside. Breadcrumbs and network entries from the widget's own activity must never appear in a report. The screenshot capturer's requests are suppressed with `client.mute(fn)`.
- **Pointer handlers in pick mode call `stopPropagation` only, never `preventDefault`, on `pointerdown`/`pointerup`.** Calling `preventDefault` there suppresses the compat `mousedown`/`mouseup` events and the drag gesture dies. `click`, `dblclick`, `contextmenu`, `selectstart` are swallowed fully.
- **Stacking inside the shadow root is explicit:** masks/pins 1, highlight/drag 2, pickbar 3, popover 4, panel/pill/pending 5, toast 6. Keep it in one rule block in `styles.ts`. A past regex edit deleted a line from this block and pins rendered above the panel.
- **Sensitive is not ignored.** `data-lightback-ignore` hides Lightback's own UI from the picker and collectors; `data-lightback-sensitive`/`privacy.selectors` keep host data out (withheld text/attrs/HTML/props, masked pixels). Every capture goes through `capture()` → `maskShot` in the widget; never store, preview or crop the capturer's raw blob.
- **Never record input values.** Breadcrumbs record that an input changed, not what was typed. Request/response bodies are opt-in (`capture.networkBodies`) and same-origin only. Default redaction runs over every string in the payload, selections and props included, through `scrubDeep` in `client.ts`.
- **Payload `version` is 1.** Adding optional fields is fine. Renaming or removing a field is a version bump and a note in `docs/ARCHITECTURE.md`.
- **Selectors prefer `data-testid`, then `id`, then a structural path anchored on the nearest ancestor with either.** Tests depend on the exact shape (`[data-testid="stat-overdue"] > div:nth-of-type(1)`).
- **Region selection is hit-test based, not geometry based.** `describeRegion` samples `elementFromPoint` on a grid and drops hits that contain other hits, so a drag over a modal resolves to the modal and not the backdrop. Do not replace it with a bounding-box intersection; that was the naive version and it picked backdrops and padding.
- **Send is optimistic.** The popover's Send and Enter queue a send with a visible countdown (`sendDelay`, default 5000). `send()` awaits the base screenshot and all crop jobs before building the draft, so a fast Enter still ships `screenshot.png` and `selection-N.png`. The panel's Send is immediate on purpose.
- **Playwright pierces the shadow root with the `lightback-widget >> ` prefix** (exported as `W` from `e2e/lib.mjs`). Text selectors are brittle here because the pill and panel share wording ("Send", "Feedback"); use `data-action`/`data-ref`.

## Where to look for a given task

| Task | Start in |
| --- | --- |
| New collector or payload field | `packages/core/src/types.ts`, `client.ts` (`buildPayload`), `prompt.ts` (render it for the model), test in `packages/core/test/core.test.ts` |
| Element/component inspection | `packages/core/src/inspect.ts` (React fiber, Vue, `data-source`), `region.ts` for drags |
| Widget behaviour | `packages/widget/src/ui.ts`; lazy lifecycle in `lazy-controller.ts`; CSS in `styles.ts` |
| Playground scenario or mock endpoint | `examples/playground/vite.config.ts` (`mockApi`), `src/Dashboard.tsx` (ChaosPanel, ExportDialog, InvoiceTable) |
| Inbox rendering of a new field | `examples/playground/src/Inbox.tsx` |
| Browser test for a flow | copy the shape of `e2e/send-flow.mjs`; use `launch()` from `lib.mjs` |

## Known limitations (do not rediscover)

- Keyboard picking traverses rendered light-DOM elements; arbitrary region drawing remains pointer-only.
- No shadow-root or iframe piercing into the host app's own shadow trees.
- Eager and lazy widget entries are available; React defaults to lazy. ESM lazy builds need URL asset support; CommonJS splitting depends on the host bundler.
- Drafts and buffers recover through session-scoped IndexedDB (default maximum age 30 minutes); screenshot persistence requires an explicit opt-in; stored images are masked, but only for marked content. Browser session restore or tab duplication can preserve/copy the session key.
- React 19 `_debugStack` parsing is best effort and may point into transformed modules. React 18/19 fixtures cover inspection and production stamp fallback; use `@lightback/source` for original JSX/TSX coordinates.
- Automatic captures refresh on the next selection after light-DOM changes or host scroll/resize/input/change/load/toggle events. Existing crops keep historical pixels. Canvas/video, CSS-only changes, host shadow roots and iframe contents are not tracked; asynchronous capturers are not atomic snapshots.
- Masks assume the capturer renders exactly the requested `area` at the current scroll position; whole-page DOM captures draw fixed/sticky elements as if scrolled to the top, so they misalign there; `domCapturer` viewport captures draw fixed elements correctly and sticky ones unstuck. Reporter masks are additive (cannot be removed from captured pixels).
- `modern-screenshot` is the playground's capturer, through `domCapturer` with `screenshotArea: 'viewport'` (`?shot=page` switches the playground to whole-page captures); the packages do not depend on it. Any `({ area }) => Promise<Blob>` works.
- DOM-cloning captures block the main thread in proportion to what they clone. Automatic captures are skipped above `screenshotMaxElements`; do not move capture work back to unconditional whole-page clones.
