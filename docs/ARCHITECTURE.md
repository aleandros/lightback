# Architecture

Three published packages, one playground, one browser test harness. Dependency direction is `core ← widget ← react`. Nothing in `core` touches the UI; nothing in `widget` knows about React.

## Data flow

```
page activity ──► collectors (ring buffers) ──┐
                                               │
user picks/drags ──► inspect/region ──► selections ─┤
                                               ├──► buildPayload(draft) ──► beforeSend ──► transport
user types note ─────────────────────────────┤        (scrubDeep redaction)                 (JSON or multipart)
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
| `client.ts` | `createLightback()`. Owns the buffers, context, `describeElement`/`describeRegion` wrappers, `buildPayload`, `send`, `mute`, `destroy`. Exports `IGNORE_ATTR = 'data-lightback-ignore'`. The configured `endpoint` is excluded from network capture. |
| `collectors/console.ts` | Patches `console.*`, formats args with `format.ts`, respects `isMuted`. |
| `collectors/errors.ts` | `window.onerror` + `unhandledrejection`. |
| `collectors/network.ts` | Patches `fetch` and `XMLHttpRequest`. Records method, url (redacted), status, ok, duration, kind. Bodies only when `capture.networkBodies` and same-origin. Honors `isMuted` and `ignore(url)`. |
| `collectors/breadcrumbs.ts` | click, change (no values), visibility, `pushState`/`replaceState`/`popstate`/`hashchange`, plus `addBreadcrumb` for custom ones. |
| `collectors/env.ts` | userAgent, language, timezone, viewport, screen, DPR, online. |
| `ring.ts` | Fixed-size ring buffer. Limits come from `options.limits`. |
| `redact.ts` | `DEFAULT_REDACT` (auth/cookie headers, secret query params, JWT and card-number regexes), `redactString`, `redactUrl`, `redactHeaders`, `truncate`. `client.ts` applies these recursively (`scrubDeep`) to the whole payload including selection text, attrs and props. |
| `inspect.ts` | `describeElement(el)` → `ElementSelection`. `uniqueSelector` (data-testid → id → structural path anchored on nearest ancestor with either). `componentChain` walks React fiber internals (`__reactFiber$…`, `_debugSource`, React 19 `_debugStack` parsing, `memoizedProps`) or Vue 3/2 internals, and falls back to a `data-source="file:line:col"` attribute. `snapshotProps` strips functions, elements and children, depth 2, 40 keys, 200-char strings. |
| `region.ts` | `describeRegion(rect)`: grid-sample `elementFromPoint` inside the rect (step ≥ 6px, ≤ 40 samples per axis), discard hits that contain other hits (backdrops, padding), container = lowest common ancestor, children = highest ancestors fully inside the rect, document order. |
| `prompt.ts` | `toPromptContext(payload)` renders bounded markdown: note, selections (kind, note, crop, components with sources, selector, text, attrs, props, rect, region children), errors, network, console, breadcrumbs, env, context, attachments. This is what a model should read; keep it in step with `types.ts`. |
| `transport.ts` | `fetchTransport`. JSON when there are no attachments, otherwise multipart with a `payload` field and one file field per attachment (`screenshot.png`, `selection-N.png`). |

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
  crop?: string;                 // attachment name of the crop PNG
  region?: { rect; docRect; children: ElementSummary[] };
}
```

## `@lightback/widget`

A `<lightback-widget>` host with a Shadow DOM. It is created directly without registering a custom-element class, so repeated mounts do not collide in the registry. `index.ts` holds the HTML template, the `Widget` class and all behaviour; `styles.ts` holds the CSS.

### Surfaces

| Surface | Class | Purpose |
| --- | --- | --- |
| Pill | `.lb-pill` | Always visible. **Point at something** (pick) and **Write feedback** (open). Shows selection count and switches to **Review & send** when a draft exists. |
| Panel | `.lb-panel` | Full editor: note textarea, pick button, screenshot preview, selection cards, collapsible review (Prompt / JSON tabs), Discard, Send (immediate). |
| Pickbar | `.lb-pickbar` | Shown during pick mode: hint, count, Cancel (keep draft), Done (open panel). |
| Highlight / drag | `.lb-highlight`, `.lb-drag` | Hover outline with component tooltip; drag rectangle. |
| Pins | `.lb-pins` | Numbered badges on each selection, re-anchored on scroll/resize, ✕ on hover removes. |
| Popover | `.lb-popover` | Inline comment box anchored to the latest selection. Remove / Add more / Send. Enter sends, Shift+Enter newline, Esc skips. |
| Pending | `.lb-pending` | "Sending feedback…" with summary and draining bar. Edit opens the panel, Cancel keeps the draft. |
| Toast | `.lb-toast` | Result message; routed into the panel status line when the panel is open. |

### Pick mode

Capture-phase listeners on `document`: `pointermove` (highlight), `pointerdown`/`pointerup` (drag detection, 5px threshold; these call `stopPropagation` only), `click` (select or finish drag; suppressed after a drag; clicking the page while the popover is open saves the comment and continues), `dblclick`/`contextmenu`/`selectstart` (swallowed), `keydown` (Escape). Anything inside an element with `data-lightback-ignore` is skipped.

Entering pick mode with a `screenshot` capturer configured (and `autoScreenshot !== false`) hides the widget host, wraps the capture in `client.mute()`, and stores the full-page bitmap. `screenshot.ts` decodes through `createImageBitmap` when available, otherwise through a temporary object URL and an image drawn to canvas; the URL is revoked on success or failure. Each new selection cuts a padded crop (`cropPadding`) from that bitmap, outlines the rect (dashed for regions) and stores it as `selection-N.png`.

### Send

`queueSend()` is used by the popover and Enter: leaves pick mode, hides panel and pill, shows the pending card, and fires `send()` after `sendDelay` ms (default 5000; 0 is immediate). `send()` awaits the base screenshot and all crop jobs, builds the draft (attachments: `screenshot.png`, `selection-N.png`), calls `client.send`, then resets and toasts on success or reopens the panel with the error. The panel's own Send button calls `send()` directly.

## `@lightback/react`

`LightbackProvider({ client, widget, context })` mounts the widget once, pushes `context` through `setContext` on change, and exposes `useLightback()` (the client) and `useLightbackWidget()` (the handle). Nothing else.

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

Pages: Dashboard (stat cards with `data-testid`, invoice table, Export modal, ChaosPanel to generate console/errors/network/breadcrumb noise) and Inbox (Summary, Screenshot with selection overlays, Prompt, JSON).

## E2E (`e2e`)

Plain Node scripts on `playwright-core` against `pnpm dev`. System Chrome is the local default; `BROWSER=chromium|firefox|webkit` selects a Playwright engine and bypasses the Chrome channel/executable override. `lib.mjs` provides `launch(suite)` returning `page`, `assert`, `received()`, `reset()`, `finish()`, plus `W` (the shadow-root prefix) and `BASE_URL`. `run.mjs` runs the four suites in sequence and exits non-zero on failure; it excludes the screenshot generator. The crop suite disables `createImageBitmap` to exercise the image/canvas fallback.

| Suite | Covers |
| --- | --- |
| `smoke.mjs` | Noise generation, panel flow, full payload assertions (redaction, bodies, breadcrumbs, context), inbox overlays. |
| `region-source-props.mjs` | Inline popover, drag over a modal resolving to the modal, source location and props in payload and inbox. |
| `pill-pins-crops.mjs` | Pill actions, removing via popover and pin, Cancel keeps draft, auto screenshot and crops. |
| `send-flow.mjs` | Popover Send and Enter, pending card Cancel/Edit, Add more, auto-send after delay with crops, Discard. |

## Invariants worth protecting

- The payload is self-describing and bounded. Every list is ring-buffered and every string truncated by `limits.string`.
- Nothing produced by the widget or the capturer leaks into the report (ignore attribute + `mute`).
- Redaction is applied last and everywhere, so a new field cannot forget it.
- The widget has no dependency other than `core`, and `core` has none.

## Distribution and CI

All module builds target ES2020, with separate `.d.ts` (ESM) and `.d.cts` (CommonJS) export conditions. The widget adds `lightback.iife.js`, bundling core and exposing `window.Lightback = { createLightback, mountWidget }`. Each tarball includes its own README and MIT license.

`.github/workflows/ci.yml` validates build, types, tests, packed consumers and strict Are the Types Wrong checks, plus a Chromium/Firefox/WebKit matrix. It is reusable so `release.yml` requires the same gates before running Changesets. Publishing uses npm 11 through pnpm, OIDC and provenance. The initial `0.1.0` packages were published locally on 2026-10-12. Each package trusts `aleandros/lightback` / `release.yml` for future uploads; the first actual OIDC upload is still to be verified. Payload version stays 1.
