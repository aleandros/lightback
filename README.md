# Lightback

![Lightback: click an element, the comment box opens right there](docs/assets/hero.png)

Framework-agnostic in-app feedback capture. Users pick the elements they are talking about, write a note, optionally attach a screenshot, and submit. The payload carries the context a developer or a model needs: component chain for each selected element, console output, errors, network requests, breadcrumbs, environment and whatever app context you attach. Nothing leaves the browser until the user sends; sending shows a cancel window, and the full preview is one click away.

## Packages

| Package | What it is |
| --- | --- |
| `@lightback/core` | Collectors, ring buffers, redaction, element inspection, payload builder, transport. No UI, no dependencies. |
| `@lightback/widget` | Drop-in UI: trigger button, element picker, notes, screenshot, review and send. Vanilla TypeScript inside a Shadow DOM. |
| `@lightback/react` | `LightbackProvider`, `useLightback()`, `useLightbackWidget()`. |
| `examples/playground` | Vite + React demo app with a mock backend and an inbox that renders what arrived. |
| `e2e` | Playwright suites for Chromium, Firefox and WebKit. |

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test                 # unit tests (vitest)
pnpm build
pnpm e2e    # browser suites; needs `pnpm dev` running and a system Chrome
```

## Compatibility and script tags

Packages ship ESM and CommonJS with matching TypeScript declarations, targeting ES2020.

| Environment | Support |
| --- | --- |
| Browsers | Evergreen releases from the last two years; Safari 15.4+ |
| SSR / Node | Node 18+ for imports and client creation; collectors are inactive on the server |
| Development and CI | Node 22 and pnpm 10 |

`describeElement`, `describeRegion` and `mountWidget` require a browser DOM and throw a clear error on the server. Mount after the DOM is ready. UUID generation falls back when `crypto.randomUUID` is unavailable; screenshot cropping can decode with an image/canvas when `createImageBitmap` is unavailable.

For a script-tag install, build and serve `packages/widget/dist/lightback.iife.js`:

```html
<script src="/vendor/lightback.iife.js"></script>
<script>
  const client = Lightback.createLightback({ endpoint: '/api/feedback' });
  Lightback.mountWidget({ client }); // Place after the page body is ready.
</script>
```

The standalone script includes core and exposes `window.Lightback`. All three packages are available on npm at `0.1.0`. The widget's `unpkg` and `jsdelivr` fields point to the standalone bundle; for example, use `https://unpkg.com/@lightback/widget@0.1.0/dist/lightback.iife.js` in the script tag above.

## Validation and releases

`pnpm build`, `pnpm typecheck`, `pnpm test` and `pnpm check:packages` validate builds, source types, unit tests, and the actual tarballs (ESM, CommonJS, IIFE, licenses, READMEs and strict type resolution).

`pnpm e2e` runs the four browser suites against `pnpm dev` using system Chrome. To use a Playwright engine:

```sh
pnpm --filter e2e exec playwright-core install chromium firefox webkit
BROWSER=webkit pnpm e2e # also chromium or firefox
```

CI runs all three engines. Screenshot regeneration remains the separate `pnpm screenshots` command. Run `pnpm changeset` for package changes; the release workflow runs the CI gates, opens a Version Packages PR, and is configured to publish subsequent merged versions with provenance through npm trusted publishing. The initial `0.1.0` release was published locally; the first automated upload remains to be verified. No npm token is stored in GitHub.

## In action

| Drag an area, even over a modal | Optimistic send with a cancel window | What the backend receives |
| --- | --- | --- |
| ![Region selection resolves to the dialog, not the backdrop](docs/assets/region-popover.png) | ![Sending card with Edit and Cancel](docs/assets/sending.png) | ![Inbox showing component chain, source, crop and props](docs/assets/inbox-summary.png) |

Regenerate these with `pnpm screenshots` while `pnpm dev` is running.

## Documentation

User guides, drafted and partly ahead of the code (sections marked **Planned**):

- `docs/guide/getting-started.md`: install, mount, first report.
- `docs/guide/customization.md`: options, CSS variables, theme, your own trigger, screenshot capturers.
- `docs/guide/backend.md`: wire contract, a receiver in Node, custom `send`, `beforeSend`, triage with a model.
- `docs/guide/texts-and-i18n.md`: the `strings` option and every label.

For contributors and agents:

- `AGENTS.md` is the entry point for agents and new contributors: commands, definition of done, conventions that are easy to break, where to look for a given task.
- `docs/ARCHITECTURE.md` describes every module, the payload shape, the widget's surfaces and the send flow.
- `docs/DECISIONS.md` records why things are shaped the way they are.
- `docs/ROADMAP.md` lists what is done, what is agreed next, and open questions.
- `docs/HANDOFF.md` is the step-by-step plan for the next tracks: compatibility and npm publishing from CI, the website at aleandros.github.io/lightback, and finishing the user guides.

## Usage

```ts
// lightback.ts, imported once at app start so buffers are warm
import { createLightback } from '@lightback/core';
import { mountWidget } from '@lightback/widget';

export const lightback = createLightback({
  endpoint: '/api/feedback',               // or send: async (payload, attachments) => {...}
  context: { release: '1.4.2' },
  capture: { networkBodies: false },       // default; bodies are opt-in and same-origin only
  redact: { headers: ['x-session'], patterns: [/acct_\w+/g] },
  beforeSend: (payload) => payload,        // mutate or return null to veto
});

lightback.setContext({ user: { id: 'u_1' }, session: 'sess_1' });

mountWidget({
  client: lightback,
  screenshot: () => import('modern-screenshot').then((m) => m.domToBlob(document.documentElement)),
});
```

React:

```tsx
<LightbackProvider client={lightback} widget={{ screenshot }} context={{ user }}>
  <App />
</LightbackProvider>
```

## Payload

The transport sends `application/json` when there are no attachments and `multipart/form-data` otherwise. In multipart, the `payload` field holds the JSON and each attachment is a file field named by its `name` (for example `screenshot.png`).

```ts
interface FeedbackPayload {
  version: 1;
  id: string;
  createdAt: string;
  page: { url; title; referrer; scroll: { x; y }; size: { width; height } };
  note: { text: string; transcript?: string };
  selections: ElementSelection[];   // selector, tag, text, attrs, rect, docRect, framework, components[], note
  attachments: { name; type; size }[];
  env: { userAgent; language; timezone; viewport; screen; devicePixelRatio; online };
  console: ConsoleEntry[];
  errors: ErrorEntry[];
  network: NetworkEntry[];
  breadcrumbs: Breadcrumb[];
  context: Record<string, unknown>;
}
```

`toPromptContext(payload)` renders the payload as bounded markdown for a model prompt. Pair it with the screenshot for a vision-capable model.

## Selecting elements and areas

The floating pill offers the two entry points directly: **Point at something** starts pick mode, **Write feedback** opens the panel. With a draft in progress the pill shows the selection count and switches to **Review & send**.

Pick mode has two gestures:

- **Click an element.** A comment box opens right next to it, focused, with the component name as its title. Enter saves, Esc skips, clicking elsewhere saves and continues picking. A numbered pin stays on the element while the draft exists.
- **Drag a rectangle.** The widget samples the browser's own hit testing on a grid inside the rectangle, so only elements that are actually visible and on top count. If a modal is open, the dragged area resolves to the modal, never to what sits behind its backdrop. The selection records the container (lowest common ancestor of what was hit, with surfaces the drag spilled onto discarded) and the largest visible elements fully inside the rectangle.

Every selection has a numbered pin on the page with a remove button on hover. The top bar shows the count with **Cancel** (leave pick mode, keep the draft) and **Done** (open the panel). The comment box has **Remove**, **Add more** (save and keep pointing) and **Send**; Enter sends.

**Sending is optimistic.** Send does not open a review step. It shows a small "Sending feedback…" card with a summary and a draining bar, and the report goes out when the bar empties (`sendDelay`, default 5000 ms, 0 for immediate). **Edit** opens the full panel with the draft, which is where the prompt and JSON preview still live. **Cancel** stops the send and keeps the draft; the pill then reads "Review & send". The panel has **Discard** to drop a draft.

**Screenshots are automatic** when a `screenshot` capturer is configured: entering pick mode captures the full page once (collectors are muted during capture so the capturer's own requests never reach the report), and each selection gets a padded crop with the selected rect outlined, attached as `selection-N.png` and referenced from `selection.crop`. Set `autoScreenshot: false` to go back to manual capture.

Each selection carries, when a dev build exposes them, a **source location** (JSX call site, from React's debug info, Vue's `__file`, or a `data-source="file:line:col"` attribute a build plugin can stamp) and a **props snapshot** of the nearest component (functions, elements and children stripped, depth-limited, redacted like every other string).

## How element selection works

The picker uses `elementFromPoint` and describes the element with a unique selector (preferring `data-testid`, then `id`, then a structural path), interesting attributes, trimmed text, and a component chain. The chain comes from React fiber internals (`__reactFiber$…`) or Vue instance internals (`__vueParentComponent`, `__vue__`), so a selection reads as `InvoiceRow ‹ InvoiceTable ‹ Dashboard ‹ App` rather than a CSS path.

## Redaction

Default rules replace `authorization`, `cookie` and similar headers, common secret query params, JWT-shaped strings and card-number-shaped digit runs. Input values are never recorded in breadcrumbs. Request and response bodies are off by default and only ever captured for same-origin requests.

## Roadmap

- v0 (this): collectors, element and area picker with inline comments, source location and props, automatic screenshot and crops, optimistic send, transport, React wrapper, playground, browser suites.
- Track A: compatibility fixes, standalone IIFE, CI and Changesets release workflow implemented; `0.1.0` published and trusted publishers configured; verification of the next automated upload remains. Website and customization/i18n APIs follow in Tracks B/C.
- v1: correlation and ranking in the prompt, a reference AI triage handler and payload JSON Schema, a Vite plugin that stamps `data-source` in production, screenshot annotations with blur, draft and buffer persistence, lazy widget.
- v2: voice notes with a pluggable transcriber, video capture via `getDisplayMedia`, optional rrweb plugin with a rolling replay window, Vue and Svelte wrappers.

Details and open questions live in `docs/ROADMAP.md`.
