# Decisions

Short records of choices that are not obvious from the code. Add one when you make a decision a future reader might want to revisit. Newest at the bottom.

## 1. TypeScript, no Rust/WASM

Considered Rust compiled to WASM for the core. Rejected: the work is DOM inspection, monkey-patching `fetch`/`console`, and JSON shaping, all of which need the JS runtime anyway. A WASM module would add 100 KB+ of runtime, an async load step, and a bridge for every DOM call, for no measurable gain. The entire core is a few KB gzipped as TypeScript.

## 2. Vanilla widget in a Shadow DOM, React only as a wrapper

The widget is a custom element with its own shadow root so it works on any host (React, Vue, Svelte, plain HTML) and host CSS cannot leak in. React support is a thin provider in `@lightback/react`. Rewriting the widget in React would couple the bundle to the host's React version and lose the framework-agnostic goal.

## 3. Payload-first, no hosted backend

Lightback ships a payload shape and a transport, nothing else. Consumers point it at their own endpoint or supply `send`. The payload is designed for an AI model to read (`toPromptContext` renders it as markdown), so the "backend" can be a function that forwards it to a model. This is the differentiator against Userback/LogRocket-style products, which own the inbox.

## 4. Context, not replay

Console, errors, network, breadcrumbs and environment in ring buffers, plus a screenshot. No DOM recording. Session replay and screen recording are deferred, not active backlog items: it multiplies payload size and privacy surface, and a model gets more from a component chain and a failed request than from a replay.

## 5. Privacy defaults are conservative

Input values are never recorded. Network bodies are off by default and same-origin only. Default redaction covers auth headers, secret query params, JWT-shaped and card-number-shaped strings, and runs over the whole payload including selection text and props. Consumers widen capture explicitly.

## 6. Component chain from framework internals, with a `data-source` escape hatch

React fiber internals (`__reactFiber$…`, `_debugSource`/`_debugStack`) and Vue instance internals give component names, source locations and props in dev builds for free. They vanish in production builds, so the fallback is a `data-source="file:line:col"` attribute a build plugin can stamp. Sourcemaps do not help element→source mapping; they help symbolicating stack traces server-side.

## 7. Region selection uses hit testing, not geometry

A dragged rectangle is resolved by sampling `elementFromPoint` on a grid and keeping only the leaf hits. This respects stacking and visibility, so a drag over a modal selects the modal and never the table under its backdrop. A pure bounding-box intersection was the first attempt and selected backdrops, padding and hidden layers.

## 8. Inline comment box, pins, and a pill with direct actions

Modelled on Claude artifacts' element annotation: click an element, the comment box appears next to it, focus stays on the page. Multiple selections get numbered pins with a hover ✕ so a selection can be removed without leaving pick mode. The floating pill exposes both entry points (point / write) so the common flow is one click shorter.

## 9. Automatic screenshot and per-selection crops

When a capturer is configured the widget captures once at pick start and cuts an outlined crop per selection. Visual reference is cheap and valuable for both humans and vision models. The capturer is injected (`screenshot: ({ area }) => Promise<Blob>`) so the packages have no dependency on `modern-screenshot` or html2canvas. On long pages "cheap" stops being true; see decision 24.

## 10. Optimistic send with a cancel window instead of a review step

Most reports are a single selection plus a sentence. The popover's Send (or Enter) therefore queues the send and shows a "Sending…" card with a draining bar (`sendDelay`, default 5 s). Cancel keeps the draft, Edit opens the full panel where the prompt and JSON preview still live. The panel's own Send is immediate because opening the panel is already the deliberate path.

## 11. E2E as plain Playwright scripts, not a test framework

The suites are Node scripts with a tiny `assert` helper, run against the dev server with the system Chrome. This keeps the dev dependency to `playwright-core` with no browser download and makes the scripts readable as step-by-step walkthroughs of the UI. Revisit if the suite count grows past a handful.

## 12. MIT for the SDK, separate terms for any hosted backend

The client packages are the distribution channel: they get embedded in other people's web apps, so any copyleft (GPL, AGPL) or source-available non-compete license (BUSL, FSL, Elastic) would stop adoption cold. MIT it is. The intended business is a hosted backend that receives the payload; that is a separate codebase and can stay proprietary or use a non-compete license without touching the SDK. The payload format is deliberately open (backend-agnostic was a day-one requirement), so the moat is the backend, not the wire format. MIT grants no trademark rights, so the name stays protectable.

## 13. Separate module declarations and a self-contained script-tag bundle

ESM and CommonJS export conditions each point to their matching declaration format, so NodeNext consumers do not resolve CommonJS code as an ESM type module. CI checks packed tarballs with strict Are the Types Wrong rules and imports them outside the workspace. The standalone widget entry bundles core; normal module entries preserve the existing dependency direction.

## 14. Release only after the same checks used for pull requests

The release workflow reuses the complete CI workflow before Changesets can publish. This duplicates CI on main, but ensures that browser and packed-package failures block a release. Changesets uses independent versions and public access. Lightback peer ranges are explicit ranges (core `>=0.0.1 <0.3.0`; React on widget `>=0.2.0 <0.3.0`, since it imports the lazy entry). `workspace:^` on a 0.x package would put the next minor out of range and promote dependents to 1.0.0, so widen ranges deliberately before each minor release. Initial npm creation and OIDC configuration must be completed before automated uploads can succeed.

## 15. Public guides in VitePress, generated reference tables

The private `docs` workspace keeps site dependencies out of the SDK. VitePress serves the existing Markdown with `/lightback/` as its project-page base. Internal architecture, decisions, roadmap and handoff stay in GitHub; they are excluded from the site. A small TypeScript AST script generates payload and UI-string reference tables from the source, avoiding a second API inventory or a full TypeDoc toolchain. See the [VitePress deployment guide](https://vitepress.dev/guide/deploy#github-pages).

## 16. Translation functions and mount-time customization

Every UI label and status has an English default in `strings.ts`; number-dependent messages are functions so the host owns plural rules. Host-supplied text is escaped at HTML boundaries. `strings.pillOpen` overrides `triggerLabel`; existing integrations keep working. Options are read at mount time. CSS variables remain the primary style contract, four surface parts allow larger changes, and explicit themes override system preference while `auto` keeps responding to it.

## 17. A static interactive demo with browser-only reports

Reuse the playground at `/lightback/demo/`, with an explicitly selected build mode so local API-based development and its tests remain intact. Hash routing avoids GitHub Pages rewrite requirements. A service worker scoped to the demo supplies simulated API responses for the real fetch/XHR collectors without a backend; it does not cache the site. A custom `send` stores the latest 20 reports and screenshots in IndexedDB, which accommodates screenshots better than localStorage. Visitors can clear the inbox. Prerecorded promotional walkthroughs are deferred.

## 18. GitHub issues own the backlog and handoff

[Backlog #19](https://github.com/aleandros/lightback/issues/19) holds the agreed ordering and links to actionable issues. Product work and AI integration improvements have separate lanes. Scope, acceptance criteria, progress and handoff notes belong on issues; source documentation continues to explain architecture and shipped behavior. The former roadmap and handoff files are stable pointers for existing links.

## 19. A lightweight trigger and a retryable UI asset

Keep client creation early, and split the UI at its mount boundary. The neutral integration opts into `@lightback/widget/lazy`; React uses it by default. A stable host preserves CSS customizations and ignores widget breadcrumbs before and after activation. Concurrent actions share a load; the latest intent wins, and close/destroy cancels pending activation.

Native browser imports cache failed URLs, so resetting a promise alone does not retry. ESM and the lazy standalone script load a self-contained UI asset with a fresh query parameter on retry; the production demo verifies Vite's URL asset emission and a real failed download. This duplicates a small amount of core helper code in the deferred asset but avoids cached failed dependency graphs. CommonJS retains a deferred module boundary for its consuming bundler. The eager entry remains available for integrations that need synchronous mounting or cannot emit URL assets.

## 20. Session recovery with redacted metadata and opt-in blobs

Use IndexedDB for bounded collector snapshots and drafts so screenshots can remain binary data. Store attachment bytes as ArrayBuffers and reconstruct Blobs on recovery; direct Blob writes failed in the local WebKit runner. A random sessionStorage key gives each tab a recovery session without putting report data in synchronous Web Storage. Recovery is enabled by default, with `persistence: false` as a complete storage opt-out, a default 5 MiB budget and a maximum 30-minute recovery age since the last checkpoint. Cleanup happens when the database next opens; browser session restoration and duplicated tabs may retain/copy the key.

Persisted strings use configured redaction before truncation, secret-named fields are redacted, and inspection HTML and form-value props are omitted. The inspector also strips controls from ancestor text/HTML. Persisting screenshot pixels requires explicit `attachments: true`; the widget stores only images masked for marked elements and hidden areas (decision 23), but unmarked content remains visible. This preserves text recovery without assuming regexes sanitize an image. Context is re-supplied by the host rather than persisted.

Never replay a pending send after reload. Restore an editable draft, retain it on send failure/veto, and clear draft plus old context buffers on successful send or discard. Storage failures must not break feedback; invalidate the session key after a failed write so a stale checkpoint does not return. Serialized writes and clear generations handle startup and teardown races. Keep recovery storage independent of the playground's sent-report inbox.


## 21. Property tests at public and platform boundaries

Use fast-check as a workspace development dependency: its generated arrays shrink action sequences and values and provide seed/path replay under Vitest. Small reference states track text, selection ids, ordered event labels and lifecycle flags. They compare public observations after each action, rather than calling production normalization or reproducing persistence queues. Plain action arrays keep replay to a single seed/path; guarded actions outside their allowed state are no-ops. Core remains dependency-free at runtime.

Use fake-indexeddb for transactions, with narrow deferred open notifications and Blob encoding for race tests. Widget tests drive the public handles and DOM hooks with controlled clocks, transport and raster callbacks. No state-management rewrite or new public test seam is needed. The normal corpus is deterministic and bounded; larger local runs are opt-in. Keep the real IndexedDB/UI browser suites and retain meaningful shrunk failures as named regressions. [TESTING.md](./TESTING.md) documents the state model and replay workflow.

## 22. Payload redaction and independently disposable collectors

Apply recursive redaction once the complete payload is assembled so page metadata, context and custom breadcrumbs have the same boundary as selections and collector entries. Resolve Dates and host `toJSON` hooks before redaction so later transport serialization cannot introduce secrets. Copy the snapshot so later body reads cannot change an already built report. Preserve schema keys while scrubbing secret-named values and embedded URLs/JSON; sanitize transport attachment names consistently with payload references. The host's `beforeSend` hook remains trusted. Reuse text extraction that strips form controls and inherited contenteditable contents for breadcrumbs and inspection.

Require both the request origin and the final response origin before recording an opt-in response body; an absent final URL fails closed. Track a per-client network generation so clear and destroy invalidate asynchronous completions without cancelling host requests. Patch wrappers become transparent when their owner is destroyed, preserve any newer client or host wrapper, and collapse inactive ancestors when restoring the original method. This supports arbitrary teardown order without a global singleton or collector dependencies.

## 23. Host-marked sensitive elements and additive opaque masks

Hosts mark sensitive subtrees with `data-lightback-sensitive` or `privacy.selectors`. Selectors are combined, validated at client creation (invalid configuration throws) and matched on the live DOM at describe and capture time, so dynamic and late-marked content is covered and ancestor context works. A sensitive selection keeps what locates it (selector, tag, rects, component names and sources) and withholds text, classes, attributes, HTML and props. A flag tells a model the absence is deliberate. Ancestors drop only their sensitive descendants, through a clone matched index-for-index with the live tree. Props are withheld whenever the owning component renders sensitive DOM, since they are the likely data source. Unknown cases fail closed. Ids and test ids remain in selectors; this is documented rather than hashed, because selectors are the product's locator.

Pixels are masked in the widget after capture, not delegated to each capturer. Rects are measured on both sides of the asynchronous capture. The image is painted with opaque fills (blur can be reversible) and re-encoded, and the unmasked bitmap is released before anything is previewed, cropped, persisted or sent. Masking failure drops the image. Reporter masks are additive: they repaint the base in place, re-cut crops and apply to later captures. Removing one could not restore pixels without retaining an unmasked copy. Restored images without known geometry are dropped when a new mask overlaps them. `payload.masks` (optional, payload version stays 1) records the boxes. `data-lightback-ignore` keeps its separate meaning: Lightback's own UI is not pickable or recorded.

## 24. Viewport captures and an element budget for DOM-cloning capturers

DOM-cloning capturers (`modern-screenshot`, `html-to-image`) compute and inline styles for every element they render, on the main thread. Measured on a 93,000-element page: 25 seconds of frozen page and a 23 MB PNG for a whole-page capture at pick start, while every other step stayed under a quarter second. Lightback cannot make the capturer faster, so it now controls what the capturer is asked for and whether it runs.

- The capturer receives `{ area }`. `screenshotArea: 'page'` stays the default so existing capturers, which ignore the argument and return the whole page, keep working. `'viewport'` is the recommended setting.
- Images record the document area they show (`attachments[].area`, optional, payload version stays 1). Consumers can no longer assume `screenshot.png` covers `page.size`.
- `domCapturer` ships the viewport recipe because the obvious versions are wrong. Skipping elements below the fold stretches tables and grids (cloners inline the container's full height), and translating the root moves fixed elements off the image. Empty boxes for off-screen elements, negative root margins and an exemption for fixed-element ancestors match the live page, at about 1 second on the same page. An element is only emptied when its content cannot spill out of its box: apps with `height: 100%` roots on long pages otherwise come out blank. Sticky elements render unstuck; recreating their stuck position would need per-library clone hooks.
- A selection the first viewport capture does not show gets a capture of the viewport it was selected on, shared by later selections on that screen; it is not recaptured merely because its padding crosses the edge.
- `domCapturer` leaves the widget out of the image instead of having the widget hide. Hiding mid-comment cost focus and keystrokes, and in WebKit scrolled the page to the top.
- An element budget (`screenshotMaxElements`, default 8000, roughly 2 seconds) skips the automatic capture when the estimated clone is larger. A capture cannot be interrupted once started, so the decision is made right before it begins (after any capture queued ahead of it), from a count that mirrors what `domCapturer` clones for the area actually captured. The manual Screenshot button remains for when the reporter decides the wait is worth it.

## 25. Shared JSX stamping with Vite and Babel adapters

Keep source instrumentation in an optional build-time package. A shared Babel visitor stamps intrinsic opening tags before JSX lowering; Vite supplies its resolved root, and Babel supports existing compiler pipelines including Webpack's babel-loader. Using a real parser avoids false tags in comments/strings, handles TSX and preserves source maps. Explicit source attributes take precedence at runtime so stamped relative locations also work in development; framework component-chain metadata remains independent.

Stamping user components would require prop forwarding and change their API, so only native tags are instrumented. Preserve explicit attributes, append generated attributes after spreads, and skip dependencies, external roots and virtual modules. Apply the same configuration on server and client; a production fixture tests matching markup and hydration. Vue and Svelte require original-template compiler hooks with their own SSR validation: transforming generated render functions cannot give accurate template coordinates. Decision 26 adds those template integrations; the JSX adapters continue to skip framework templates.

## 26. Lifecycle/context helpers and original-template adapters for Vue and Svelte

`@lightback/vue` and `@lightback/svelte` expose `provideLightback`, `useLightback` and `useLightbackWidget`. The provider is a setup/initialization function, so applications keep their own component structure. Vue exposes a shallow readonly ref and watches reactive context; Svelte exposes a readable store and subscribes to context stores. Both use the lazy widget, capture client/widget configuration once, and tear down only resources they own. Client lifetime remains with the host. Mount hooks keep SSR free of DOM work and context subscriptions; context keys scope providers to each component tree. Svelte's runtime is ESM, so its integration is ESM too, while Vue retains ESM/CommonJS exports.

Vue's Vite pre-transform reads the SFC compiler's original AST. Svelte's markup preprocessor reads the modern template AST before other preprocessing. Both insert attributes at parsed attribute boundaries with MagicString maps, avoiding generated render-function coordinates and expression scanning. They preserve manual attributes and only stamp native tags. Compiler peers remain optional and isolated in their adapter entry points. Production browser fixtures validate exact file/line/column, identical SSR/client stamps, DOM reuse through hydration, real pick/send payloads and prompts, reactive context, repeated mount and lazy teardown. Core's existing source fallback needs no payload change or new Svelte runtime internals.

## 27. Local coding-agent feedback through a separately owned MCP bridge

Use a separately installable Node package and portable stdio tools to supply feedback to an existing Claude Code or Codex conversation. Keep the receiver alive independently of the agent transport: two clients and reconnects share one project/session queue instead of competing for the listening port. Keep browser/server credentials separate, require an exact app origin, bind only a literal loopback address, and pass routing in the authenticated URL envelope rather than trusting captured app context.

The receiver keeps bounded reports and already masked PNGs in memory for 30 minutes; stopping it clears them. Persistent screenshots would need a separate explicit persistence decision and retention model. Stable retained payload IDs, message idempotency and optimistic revisions handle retries and follow-ups without claiming exclusive leases or exactly-once code changes. Conversation/status fields remain outside payload v1.

Start with an optional compact report thread in the MCP package's independent browser entry. It needs no changes or dependencies in the widget and can be omitted by endpoint-only consumers. Captured reports and replies remain untrusted text; only the coding host has editing tools. Explicit list/wait calls in a user-started conversation are the cross-client delivery contract. Do not emulate keystrokes into an arbitrary chat or assume notifications can start a turn. Local protocol and browser fixtures validate the complete loop without paid inference; installed-host smoke tests check the clients separately.


## 28. Automatic receiver startup with a bounded independent lifetime

Let the coding host launch the receiver through its existing stdio MCP command. Users should not need a second terminal to manage an implementation detail. Preserve the separately owned queue by spawning a detached process, reusing it only after an authenticated health check confirms the connection configuration and package version. Concurrent starts use create-only credential publication (atomic hard-link publication where available; exclusive writes with bounded reader retries otherwise) and the OS listening socket as the arbiter; never overwrite credentials, kill an unknown process, or silently adopt another project on the same port.

Managed receivers exit after 30 minutes without authenticated activity; active requests, including long polls, finish before idle shutdown. Open stdio connections send periodic authenticated health checks so an idle conversation stays usable; disconnecting clears that timer. Browser thread polling also counts as activity. Explicit `stop` clears the queue, while foreground `serve` remains a diagnostic escape hatch. A reconnect starts a missing receiver; a stopped receiver is not restarted by retrying a mutation. This preserves clear revision and instance-reset semantics without replaying a write against a new queue.

Managed receivers also check their own config file on requests and once a second, stopping if it disappears, becomes invalid or changes identity. Temporary file-lock/resource errors get a three-second grace period before shutdown. Lifecycle endpoints remain available when report request slots are full, and `stop` distinguishes an unavailable listener from an absent one. This prevents an obsolete browser from keeping a receiver alive after credentials are regenerated. Idle accounting uses a monotonic clock and grants a fresh idle window when a timer resumes late after sleep, allowing the host heartbeat to resume before shutdown.

## 29. Keyboard picking with focus retained inside the widget

Give the picker its own focused application control instead of adding tabindex or focusing arbitrary host nodes. Arrow keys traverse rendered light-DOM elements, including noninteractive containers; Enter/Space uses the existing selection or mask path. This keeps host forms and buttons untouched and gives keyboard users the same inspection/redaction boundary. Only the picker control captures navigation keys; comments retain normal text editing. Tab stays among active picker/comment controls, with Cancel and Done always reachable.

Keep a visually hidden live region mounted independently of the visual help. Make the widget transparent during custom captures to preserve text focus, and pause picker navigation so it cannot move the screenshot area before masking. Announce unique locators rather than DOM text or values, revalidate dynamic targets before selection, and scroll offscreen targets into view. Preserve the existing Escape-to-review behavior; Cancel returns to the entry surface and close/send restores the opener, resolving a lazy shell trigger after replacement. Arbitrary drawn regions, host shadow trees and iframe contents remain outside this keyboard implementation.

## 30. Hidden-subtree pruning and explicit image-free sends

Share the budget and renderer filter so hidden responsive layouts cannot inflate the element budget or clone cost. Use cached client rects, consulting display only for boxless elements; preserve display:contents, native select options, SVG paint resources, word-break opportunities, off-screen layout placeholders and paths to fixed descendants. Share fixed-element discovery between budget and renderer filters, refresh geometry for cloning, and stop counting above the limit. Bind preparation metadata to its original capturer so wrappers retain their behavior. Keep the 8,000-element default. A failed or skipped automatic capture highlights the editor screenshot action. After pending image jobs settle, an image-free draft with a configured capturer requires an explicit Add screenshot or Send anyway choice; the latter is remembered through transport retries until that draft ends. Localization adds three string keys without changing the payload or core package.

## 31. Deterministic evidence ranking in the prompt formatter

Group collector evidence before applying display limits, so repeated polling cannot crowd out distinct failures. Keep groups within their collector section, prioritize failed requests and console severity, then sort by distance from the latest captured click, input change or navigation at or before submission. Use submission time when none exists. Selections have no timestamps; adding a field would not recover historical interaction time. Navigation may be programmatic and the latest action may be unrelated, so the prompt names its heuristic anchor and explicitly disclaims causality.

Use complete evidence fields as identity, not truncated display text or fuzzy URL/message normalization. Request durations may vary within a group and render as a range. Rank by the nearest actual occurrence, not a spanning interval that could contain no event. Retain first/last times, repetition counts and nearest time; equal ranks preserve first input appearance. Keep raw arrays untouched. The existing maxLogLines option now counts distinct groups per collector (default 40), with zero omitting entries; maxChars bounds the entire prompt (default 64,000), including a truncation notice. This remains a dependency-free formatter in browser and Node, with no payload-version change or backend requirement.

## 32. Independent image annotation layers over masked originals

Keep editable rectangles, arrows, ellipses and text labels in a bounded, draft-only vector layer for each screenshot or crop. Normalized image endpoints preserve alignment across viewport/page captures, scroll, DPR and preview scaling without changing document-space selection geometry. A crop is its own image: annotating the screenshot does not implicitly alter crops, and explicitly retaking an image clears its old layer. Adding more selections preserves an annotated screenshot while new crops use a fresh capture. Existing crop outlines remain pixels; privacy masks are already baked into every retained source, so reset and undo can never uncover content.

Render the same PNG for preview and delivery. Store only masked originals plus vector layers for opt-in image recovery, avoiding duplicate full-resolution blobs and allowing post-reload editing. Text fits its normalized box using canvas font measurements, with no external fonts; the same box controls selection and resizing. Core validates and persists layer metadata but remains independent of canvas rendering; the widget flattens before send and payload version 1 stays unchanged. Cap layers at the screenshot plus 50 crops, shapes at 50 per image, and active-editor undo at 20 states. Put labeled icon tools and direct manipulation first, with exact coordinates under a native details disclosure. Active tools use aria-pressed, and editor-only endpoint handles never enter exported pixels. Native buttons, a shape selector and endpoint inputs keep every operation available without pointer drawing.
