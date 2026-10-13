# Architecture

Three published packages, one playground, one browser test harness. Dependency direction is `core ← widget ← react`. Nothing in `core` touches the UI; nothing in `widget` knows about React.

## Data flow

```
page activity ──► collectors (ring buffers) ──┐
                                               │
user picks/drags ──► inspect/region ──► selections ─┤
                                               ├──► buildPayload(draft) ──► beforeSend ──► transport
user types note ─────────────────────────────┤        (redactDeep redaction)                 (JSON or multipart)
screenshot + crops (widget) ─────────────────┘
```

1. `createLightback(options)` installs collectors at browser app start, so the buffers are warm when the user eventually reports. On the server every installer is a no-op (including console and network); environment/page fields have empty defaults. DOM inspection and widget mounting throw explicit browser-DOM errors.
2. The widget keeps a **draft**: note text, selections, screenshot blob, crop blobs.
3. `client.send(draft)` builds the payload, runs `beforeSend`, and hands payload plus attachments to the transport.
4. The transport posts to `endpoint`, or calls the consumer's `send`.

## `@lightback/core`

| File | Responsibility |
| --- | --- |
| `types.ts` | Every public shape. `FeedbackPayload` is `version: 1`. |
| `client.ts` | `createLightback()`. Owns the buffers, context, `describeElement`/`describeRegion` wrappers (both pass the client's sensitive selector), `isSensitive`, `sensitiveRects`, `buildPayload` (adds validated `masks` from the draft), `send`, `mute`, `destroy`. Exports `IGNORE_ATTR = 'data-lightback-ignore'`. The configured `endpoint` is excluded from network capture. |
| `collectors/console.ts` | Patches `console.*`, formats args with `format.ts`, respects `isMuted`. |
| `collectors/errors.ts` | `window.onerror` + `unhandledrejection`. |
| `collectors/network.ts` | Patches `fetch` and `XMLHttpRequest`. Records method, url (redacted), status, ok, duration, kind. Bodies only when `capture.networkBodies` and same-origin; response bodies also require a verified same-origin final URL. Per-client epochs invalidate pending captures on clear/destroy. Honors `isMuted` and `ignore(url)`. |
| `collectors/breadcrumbs.ts` | click, change (no values), visibility, `pushState`/`replaceState`/`popstate`/`hashchange`, plus `addBreadcrumb` for custom ones. |
| `collectors/patch.ts` | Composable method wrappers for console, fetch/XHR and history. Teardown disables the collector, preserves newer wrappers, and collapses inactive wrappers when restoring a method. |
| `collectors/env.ts` | userAgent, language, timezone, viewport, screen, DPR, online. |
| `ring.ts` | Fixed-size ring buffer. Limits come from `options.limits`. |
| `redact.ts` | `DEFAULT_REDACT` (auth/cookie fields, secret query params, JWT and card-number regexes), string/URL helpers, `redactText`, `redactDeep`, `truncate`. `buildPayload` normalizes JSON serialization (including Dates and host `toJSON` hooks), then recursively copies and redacts the complete payload, including embedded URLs/JSON, page metadata, context and breadcrumbs. Attachment names are scrubbed identically in payload references and transport metadata. `beforeSend` receives this snapshot and is a trusted host transformation. |
| `sensitive.ts` | `SENSITIVE_ATTR`, `sensitiveSelector(selectors)` (attribute plus `privacy.selectors`, validated; invalid throws), `isSensitive` (`closest`), `containsSensitive`, `sensitiveRects` (document-space union of the element box and a contents `Range`, so overflow is covered). Selector errors at match time count as sensitive. |
| `inspect.ts` | `describeElement(el, { sensitive })` → `ElementSelection`. A sensitive element (or descendant of one) keeps selector, tag, id, rects and components but gets empty text/attrs/classes, no HTML/props and `sensitive: true`. Ancestors use `safeClone`, which matches on the live tree and replaces sensitive descendants with empty attribute-free placeholders before text/HTML extraction. Props are withheld (sentinel, so outer components are not used instead) when the nearest component's React fiber subtree or Vue rendered roots contain sensitive DOM; unknown roots and subtrees over 5000 fibers fail closed; the walk is skipped when the document has no sensitive match. `uniqueSelector` (data-testid → id → structural path anchored on nearest ancestor with either). `componentChain` walks React fiber internals (`__reactFiber$…`, `_debugSource`, React 19 `_debugStack` parsing, `memoizedProps`) or Vue 3/2 internals, and falls back to a `data-source="file:line:col"` attribute. `snapshotProps` strips functions, elements and children, depth 2, 40 keys, 200-char strings. |
| `region.ts` | `describeRegion(rect)`: grid-sample `elementFromPoint` inside the rect (step ≥ 6px, ≤ 40 samples per axis), discard hits that contain other hits (backdrops, padding), container = lowest common ancestor, children = highest ancestors fully inside the rect, document order. Container and children are described with the same sensitive selector. |
| `prompt.ts` | `toPromptContext(payload)` renders bounded markdown: note, selections (kind, note, crop, components with sources, selector, sensitivity, text, attrs, props, rect, region children), screenshot mask counts, errors, network, console, breadcrumbs, env, context, attachments. This is what a model should read; keep it in step with `types.ts`. |
| `client.ts` attachments | Image attachments may carry `area`, the document rect they show (`screenshot.png`: the page or the viewport; crops: their padded rect). `cleanArea` keeps it only as four finite numbers with positive size, in drafts, recovery, payload and transport. Consumers map `docRect`s onto an image through it; without it, `screenshot.png` covers `page.size`. |
| `transport.ts` | `fetchTransport`. JSON when there are no attachments, otherwise multipart with a `payload` field and one file field per attachment (`screenshot.png`, `selection-N.png`). |

### Session recovery

`persistence.ts` owns the version-1 IndexedDB `lightback-recovery` / `sessions` store. `sessionStorage["lightback:session:<key>"]` contains only a random record key; the default namespace is `default`. Core starts collectors immediately, then `client.ready` reads recovery data and merges the old events with new startup events in timestamp order, bounded by current ring limits and capture options. Context is always supplied fresh by the host. `RingBuffer` changes schedule a 100 ms checkpoint, and asynchronously completed network bodies notify it again. A generation captured before the database open and a serialized write queue ensure clear beats pending opens, reads and writes. Recovery sorts all retained timestamps before applying the current buffer limits, including when those limits shrink.

`recovery-redact.ts` scrubs every persisted metadata string and secret-named field, including embedded URL parameters and JSON bodies, before truncating. It omits inspection HTML and form-value fields. Selections are already sanitized for sensitive elements when described; draft `masks` are validated (reason and finite rect) on save and recovery. String values use `limits.string`; metadata field names have at least a 64-character budget so tiny value limits cannot rename recovery schema fields. Drafts keep at most 50 selections. Blob attachments are stored as binary ArrayBuffers and reconstructed on recovery to avoid native Blob write failures in WebKit environments. Encoded bytes are cached per Blob so page-hide checkpoints do not re-read backing files that navigation may revoke. They require `persistence.attachments: true`; the widget hands core only masked images. Default recovery stores metadata only. The default snapshot budget is 5 MiB. Oversized attachments and their references are omitted; oversized metadata deletes the checkpoint.

Records expire after the last checkpoint (default/maximum 30 minutes, configurable shorter). Reads purge expired, incompatible or malformed records. Expired records from closed tabs are physically removed on the next storage open; browser-restored/duplicated sessions can retain/copy the tab key. Denial, quota failure, blocked opens and missing storage fall back to memory; write errors invalidate the session key to prevent stale recovery. `persistence: false` makes no recovery storage calls. This database is independent of the demo inbox. The recovery schema is separate from payload version 1.

`getDraft`, `saveDraft`, `flushPersistence` and `clearPersistence` support custom editors. Successful sends clear the current stored draft and all four collector buffers, including intervening edits/events; failed/vetoed sends retain current state. The submitted payload is the snapshot built before the asynchronous hook/transport. Widget Discard calls the same clear API. Clear increments a per-client network epoch so pending fetch/XHR and cloned-body completions cannot refill buffers or schedule stale checkpoints. Destroy invalidates pending captures, flushes best-effort and unregisters listeners; it does not abort host requests. Independently created clients can be destroyed in any order without disabling or reviving each other’s collectors. The widget checkpoints each note input and selection/attachment change, guards late screenshot work after discard/destroy, and restores object URLs after recovery without resuming picking or send timers. The lazy shell reads only draft metadata to show the count, leaving the UI deferred. Older core clients without recovery APIs still mount with memory-only behavior.

### Selection shape

```ts
interface ElementSelection {
  id; kind: 'element' | 'region';
  selector; tag; elementId?; classes; text; attrs;
  rect; docRect;                 // viewport and document coordinates
  framework; components: string[]; chain: ComponentInfo[];
  source?: SourceLocation;       // file:line:col when a dev build exposes it
  props?: Record<string, unknown>;
  note?; html?;
  sensitive?: true;              // content withheld; selector and components remain
  crop?: string;                 // attachment name of the crop PNG
  region?: { rect; docRect; children: ElementSummary[] };
}
```

## `@lightback/widget`

A `<lightback-widget>` host with a Shadow DOM. It is created directly without registering a custom-element class, so repeated mounts do not collide in the registry. `index.ts` is the eager public entry; `ui.ts` holds the HTML template, the `Widget` class and all behaviour; `styles.ts` holds the CSS.

`WidgetOptions` accepts a partial `strings` table merged over `defaultStrings` (`strings.ts`), a forced light/dark or automatic theme via `data-theme`, and `hideTrigger`. Translation text is escaped wherever inserted into HTML. `triggerLabel` remains an alias; `strings.pillOpen` wins. The pill, panel, popover and pending surfaces expose matching CSS parts. Options are read at mount time.

### Lazy entry

`@lightback/widget/lazy` exports `mountLazyWidget()`. `lazy-controller.ts` mounts only a styled, translated pill using `shell.ts`, retains a stable host and coalesces pending open/pick intents. Options are snapshotted at mount. Closing cancels activation; destroying guards late resolution. Failures leave the trigger usable, call `onError`, and reject the action promise (with an internal rejection handler for void-style event callers). Core collectors remain active throughout the download.

The ESM build references a self-contained `lightback-ui.js` URL asset. Bundlers such as Vite emit it via `new URL(..., import.meta.url)`. Failed native imports are cached by browsers, so subsequent attempts use a fresh query parameter. Bundling UI dependencies into this asset avoids retaining failed dependency URLs. CommonJS uses a deferred `require` chunk and delegates network splitting to the consuming bundler. Source development uses the dev server's transformed `ui.ts`; production playground builds consume the built lazy package. `pnpm build:site` builds packages first so URL assets exist on a clean checkout.

The lazy standalone bootstrap (`lightback-lazy.iife.js`) includes core and the controller; it resolves `lightback-ui.js` beside its own script URL, with a `widgetUrl` override. The eager entry and IIFE remain available. Both paths reuse the UI class, styles and strings. Payload version stays 1.

### Surfaces

| Surface | Class | Purpose |
| --- | --- | --- |
| Pill | `.lb-pill` | Always visible. **Point at something** (pick) and **Write feedback** (open). Shows selection count and switches to **Review & send** when a draft exists. |
| Panel | `.lb-panel` | Full editor: note textarea, pick button, screenshot preview, selection cards, collapsible review (Prompt / JSON tabs), Discard, Send (immediate). |
| Pickbar | `.lb-pickbar` | Shown during pick mode: hint, count, Hide area toggle (with a capturer), Cancel (keep draft), Done (open panel). |
| Masks | `.lb-masks` | Hatched boxes over reporter-hidden areas while picking. Pointer-transparent. |
| Highlight / drag | `.lb-highlight`, `.lb-drag` | Hover outline with component tooltip; drag rectangle. Hidden while the pointer is over widget UI, so it never covers pins or the popover. |
| Pins | `.lb-pins` | Numbered badges on each selection, re-anchored on scroll/resize, ✕ on hover removes. Hovering a selection card in the panel lights up its pin (`.lb-pin.hover`). |
| Popover | `.lb-popover` | Inline comment box anchored to the latest selection. Remove / Add more / Send. Enter sends, Shift+Enter newline, Esc skips. |
| Pending | `.lb-pending` | "Sending feedback…" with summary and draining bar. Edit opens the panel, Cancel keeps the draft. |
| Toast | `.lb-toast` | Result message; routed into the panel status line when the panel is open. |

### Pick mode

Capture-phase listeners on `document`: `pointermove` (highlight), `pointerdown`/`pointerup` (drag detection, 5px threshold; these call `stopPropagation` only), `click` (select or finish drag; suppressed after a drag; clicking the page while the popover is open saves the comment and continues), `dblclick`/`contextmenu`/`selectstart` (swallowed), `keydown` (Escape). Anything inside an element with `data-lightback-ignore` is skipped.

Entering pick mode with a `screenshot` capturer configured (and `autoScreenshot !== false`) queues a budgeted capture. Captures are serialized through `captureQueue` (each may hide and restore the host), and the budget is checked when a capture runs, against the area it captures: `captureCost` (`capture.ts`) counts what the capturer will clone (every element for a whole-page area; for a viewport area, the elements `domCapturer` cannot reduce to an empty box). Above `screenshotMaxElements` (default 8000) the capture is skipped and the base resolves to null with a toast. Otherwise the capturer is called with `{ area }` (the whole document, or the viewport with `screenshotArea: 'viewport'`) inside `client.mute()`, and the bitmap is stored with that area (`Shot.area`). Capturers marked `OMITS_WIDGET` (`domCapturer`) leave the host out of the image, so the widget is not hidden and keeps focus and keystrokes. Others get the host hidden; focus is moved out of the shadow root first and restored with `preventScroll`, because WebKit scrolls the page to the top when a focused element inside the fixed host becomes hidden. `domCapturer` is the shipped adapter for DOM-cloning renderers: for a viewport area it offsets the root with negative margins (a transform would carry fixed elements off the image) and filters out the children of any element entirely outside the area whose content cannot spill out of its box (`scrollWidth`/`scrollHeight` within its client size, non-zero box), keeping the element itself as a sized box so layout does not move. Ancestors of fixed elements are exempt. Rects are memoized per capture. Dropping off-screen elements outright is not an option: cloners inline computed heights, so a table that lost its rows stretches the rest. Sticky elements render unstuck (the clone is not scrolled). `screenshot.ts` decodes through `createImageBitmap` when available, otherwise through a temporary object URL and an image drawn to canvas; the URL is revoked on success or failure. Each new selection cuts a padded crop (`cropPadding`) from that bitmap, outlines the rect (dashed for regions) and stores it as `selection-N.png` with its document `area`. In viewport mode each selection records the viewport it was made on (`seenFrom`); when the base does not show the selection's part of that viewport (the page scrolled), the crop comes from `extraShot`, a budgeted capture of that viewport that later selections reuse while it covers theirs. Its sensitive rects join `baseMasks`. A new mask drops the reused capture (it lacks the mask), re-cuts every crop it overlaps whatever image it came from, and a crop job that finishes after a mask overlapping it was added discards its result for that re-cut. The crop is in bitmap pixels (capture scale, e.g. 2× on Retina); its card thumbnail is auto-sized with only maximum constraints, capped at the crop's CSS width, so it keeps its proportions and never grows past on-page size. Do not give it a fixed width or let the card's flex column stretch it. A restored crop's cap comes from its persisted `area`; drafts from before 0.2.2 have none, so it is estimated from the selection rect against the current page (`cropArea`). A restored screenshot with an `area` can be repainted by later masks. While a region is described, existing pins are made pointer-transparent so hit testing sees the page beneath them.

Every capture (automatic or manual) goes through `capture()`: sensitive rects are measured before and after the capturer, then `maskShot` (`screenshot.ts`) draws the decoded image to a canvas, fills each sensitive rect and reporter mask (2 CSS px bleed, scaled to the bitmap) and re-encodes. The raw bitmap is released and only the masked blob/canvas is kept, so previews, crops, recovery and sends never see unmasked pixels; failure drops the image and calls `onError`. In mask mode (`data-action="mask-mode"`), a click or drag adds a reporter mask instead of a selection. `addMask` queues a serial `maskJob` that repaints the base shot in place (bumping `baseVersion`, so in-flight crops of older pixels are discarded), re-masks a manual screenshot, drops then re-cuts this session's crops that overlap the area (plus in-flight crops the repaint discarded), and drops restored screenshots/crops whose geometry is unknown. A failed mask drops every image and bumps `baseVersion` so in-flight crops are discarded too. The hover tooltip uses `componentChain` (names only) rather than a full description. Masks are additive; Discard clears them. The draft records reporter masks (always, for later captures) and the sensitive rects painted into the attached screenshot and base as `masks`; core reports them in the payload only when attachments exist, with sensitive and reporter masks capped separately.

### Send

`queueSend()` is used by the popover and Enter: leaves pick mode, hides panel and pill, shows the pending card, and fires `send()` after `sendDelay` ms (default 5000; 0 is immediate). `send()` awaits pending mask jobs, the base screenshot and all crop jobs, builds the draft (attachments: `screenshot.png`, `selection-N.png`), calls `client.send`, then resets and toasts on success or reopens the panel with the error. The panel's own Send button calls `send()` directly. Before starting transport, the widget checks that discard/destroy did not invalidate its pending image work. Late transport completions cannot invoke callbacks or reopen a discarded/destroyed widget; an already-started transport still follows the core send lifecycle.

## `@lightback/react`

`LightbackProvider({ client, widget, context })` mounts a lazy widget handle once, pushes `context` through `setContext` on change, and exposes `useLightback()` (the client) and `useLightbackWidget()` (the handle). Nothing else.

## Playground (`examples/playground`)

Vite + React 18. Aliases point at package `src`, so no build is needed for `pnpm dev`. `vite.config.ts` contains `mockApi`, an in-memory backend:

| Endpoint | Behaviour |
| --- | --- |
| `POST /api/feedback` | Accepts JSON or multipart; stores payload and files as data URLs; emits a Vite WS event the inbox listens to. |
| `GET /api/feedback`, `DELETE /api/feedback` | List and clear. The e2e suites use both. |
| `GET /api/invoices` | 200 with a small list. |
| `POST /api/fail` | 500, "payments service unavailable". Used by the overdue invoice's Pay button. |
| `GET /api/notfound?token=…` | 404; proves query-param redaction. |
| `GET /api/slow`, `/api/echo` | Latency and XHR scenarios for the ChaosPanel. |

The public demo uses `vite build --mode demo` with base `/lightback/demo/` and hash navigation, so inbox links and refreshes work on a static host. `bootstrap.ts` activates a scoped service worker before mounting the app. `public/demo-worker.js` simulates only the demo API (including fetch and XHR); it does not cache assets or intercept the docs. The normal development API remains unchanged.

In demo mode, the custom `send` in `submissions.ts` stores payloads and attachment data URLs in IndexedDB, retaining the latest 20 reports. Reads and clears use the same store, with errors surfaced in the inbox/widget. Reports never leave the browser. This is example inbox storage, not SDK draft/buffer persistence. The external cross-origin noise button is omitted from the public demo.

Pages: Dashboard (stat cards with `data-testid`, invoice table, Export modal, ChaosPanel to generate console/errors/network/breadcrumb noise) and Inbox (Summary with sensitive flags and mask counts, Screenshot with selection overlays, Prompt, JSON). The sidebar account card is marked `data-lightback-sensitive` and the client configures `privacy.selectors: ['.chaos input']`, so demo screenshots show both kinds of mask.

## E2E (`e2e`)

Plain Node scripts on `playwright-core` against `pnpm dev`. System Chrome is the local default; `BROWSER=chromium|firefox|webkit` selects a Playwright engine and bypasses the Chrome channel/executable override. `lib.mjs` provides `launch(suite)` returning `page`, `assert`, `received()`, `reset()`, `finish()`, plus `W` (the shadow-root prefix) and `BASE_URL`. `run.mjs` runs the nine suites in sequence and exits non-zero on failure; it excludes the screenshot generator. The crop suite disables `createImageBitmap` to exercise the image/canvas fallback.

| Suite | Covers |
| --- | --- |
| `privacy-masking.mjs` | Sensitive attribute, configured selector, nested and dynamic elements, regions and breadcrumbs; masked pixels in previews, crops, IndexedDB bytes and sent images (fixture capturer paints red); reporter Hide area, reload, retake and send. |
| `session-recovery.mjs` | Real IndexedDB recovery of text, selection notes, blobs and context across reloads; deletion on send/discard, tab isolation and pending-send cancellation. |
| `lazy-loading.mjs` | Deferred React/neutral/standalone loading, first interaction, real import failure and retry, host identity and teardown. |
| `smoke.mjs` | Noise generation, panel flow, full payload assertions (redaction, bodies, breadcrumbs, context), inbox overlays, native fetch/XHR redirect body privacy. |
| `region-source-props.mjs` | Inline popover, drag over a modal resolving to the modal, source location and props in payload and inbox. |
| `pill-pins-crops.mjs` | Pill actions, removing via popover and pin, Cancel keeps draft, auto screenshot and crops; `helpers/customization.mjs` checks translations, themes, hidden trigger and CSS parts. |
| `crop-aspect.mjs` | Wide, tall and small region crops at DPR 1 and 2: exported pixel size matches rect plus padding, widget thumbnails and inbox previews keep natural proportions and are never enlarged. |
| `large-page.mjs` | A ~93,000-element table: whole-page mode skips the automatic capture with a notice and stays responsive; viewport mode captures in about a second, records the screenshot and crop `area`s, and re-captures for a selection scrolled outside the base without moving the scroll position; a `height: 100%` app root scrolled down still yields non-blank images, and keystrokes typed during that capture reach the comment box; whole-page mode on an ordinary page still reports `area` equal to `page.size`. |
| `send-flow.mjs` | Popover Send and Enter, pending card Cancel/Edit, Add more, auto-send after delay with crops, Discard. |

## Invariants worth protecting

- The payload is self-describing and bounded. Every list is ring-buffered and every string truncated by `limits.string`.
- Nothing produced by the widget or the capturer leaks into the report (ignore attribute + `mute`).
- Sensitive content never leaves inspection: no text, attributes, HTML or props from sensitive subtrees, and no image is kept before it is masked.
- Redaction is applied last and everywhere, so a new field cannot forget it.
- The widget has no dependency other than `core`, and `core` has none.

## Distribution and CI

All module builds target ES2020, with separate `.d.ts` (ESM) and `.d.cts` (CommonJS) export conditions. The widget adds `lightback.iife.js`, bundling core and exposing `window.Lightback = { createLightback, mountWidget, defaultStrings }`. Each tarball includes its own README and MIT license.

`.github/workflows/ci.yml` validates build, types, tests, packed consumers and strict Are the Types Wrong checks, plus a Chromium/Firefox/WebKit matrix. It is reusable so `release.yml` requires the same gates before running Changesets. Publishing uses npm 11 through pnpm, OIDC and provenance. The initial `0.1.0` packages were published locally on 2026-10-12. Each package trusts `aleandros/lightback` / `release.yml`. Widget `0.1.1` verified the first actual OIDC upload with npm provenance on 2026-10-12 ([run](https://github.com/aleandros/lightback/actions/runs/38297673131)). Payload version stays 1.

## Documentation site

`docs` is a private VitePress workspace, with base `/lightback/`. `pnpm build:site` builds the docs and playground, then `scripts/assemble-site.mjs` copies the demo into the Pages artifact. `pnpm e2e:demo` serves those built files without a fallback or mock backend and exercises send, screenshots, inbox, refresh, isolation and clearing. CI runs it on all three browser engines. The home page and `docs/guide/` are public; internal planning files are excluded. `scripts/generate-reference.mjs` uses the TypeScript parser to regenerate payload and string reference tables during the docs build. CI builds the site and rejects stale generated tables. `.github/workflows/pages.yml` builds and deploys the site on main, with Pages configured to use Actions. The [site](https://aleandros.github.io/lightback/) is live. Build output and VitePress cache are ignored.

## Stateful property tests

Core and widget run deterministic fast-check action models and focused invariant properties in normal `pnpm test`, with no browser or network dependency. Clocks, storage failures, database-open notifications, transports and image completions are controlled at test boundaries. See [TESTING.md](./TESTING.md) for state ownership, transitions, replay and larger runs. Existing browser suites retain coverage of native IndexedDB, image rendering and loading.
