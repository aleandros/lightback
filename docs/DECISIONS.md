# Decisions

Short records of choices that are not obvious from the code. Add one when you make a decision a future reader might want to revisit. Newest at the bottom.

## 1. TypeScript, no Rust/WASM

Considered Rust compiled to WASM for the core. Rejected: the work is DOM inspection, monkey-patching `fetch`/`console`, and JSON shaping, all of which need the JS runtime anyway. A WASM module would add 100 KB+ of runtime, an async load step, and a bridge for every DOM call, for no measurable gain. The entire core is a few KB gzipped as TypeScript.

## 2. Vanilla widget in a Shadow DOM, React only as a wrapper

The widget is a custom element with its own shadow root so it works on any host (React, Vue, Svelte, plain HTML) and host CSS cannot leak in. React support is a thin provider in `@lightback/react`. Rewriting the widget in React would couple the bundle to the host's React version and lose the framework-agnostic goal.

## 3. Payload-first, no hosted backend

Lightback ships a payload shape and a transport, nothing else. Consumers point it at their own endpoint or supply `send`. The payload is designed for an AI model to read (`toPromptContext` renders it as markdown), so the "backend" can be a function that forwards it to a model. This is the differentiator against Userback/LogRocket-style products, which own the inbox.

## 4. Context, not replay

Console, errors, network, breadcrumbs and environment in ring buffers, plus a screenshot. No DOM recording. rrweb-style replay is a later optional plugin, not a core concern: it multiplies payload size and privacy surface, and a model gets more from a component chain and a failed request than from a replay.

## 5. Privacy defaults are conservative

Input values are never recorded. Network bodies are off by default and same-origin only. Default redaction covers auth headers, secret query params, JWT-shaped and card-number-shaped strings, and runs over the whole payload including selection text and props. Consumers widen capture explicitly.

## 6. Component chain from framework internals, with a `data-source` escape hatch

React fiber internals (`__reactFiber$…`, `_debugSource`/`_debugStack`) and Vue instance internals give component names, source locations and props in dev builds for free. They vanish in production builds, so the fallback is a `data-source="file:line:col"` attribute a build plugin can stamp. Sourcemaps do not help element→source mapping; they help symbolicating stack traces server-side.

## 7. Region selection uses hit testing, not geometry

A dragged rectangle is resolved by sampling `elementFromPoint` on a grid and keeping only the leaf hits. This respects stacking and visibility, so a drag over a modal selects the modal and never the table under its backdrop. A pure bounding-box intersection was the first attempt and selected backdrops, padding and hidden layers.

## 8. Inline comment box, pins, and a pill with direct actions

Modelled on Claude artifacts' element annotation: click an element, the comment box appears next to it, focus stays on the page. Multiple selections get numbered pins with a hover ✕ so a selection can be removed without leaving pick mode. The floating pill exposes both entry points (point / write) so the common flow is one click shorter.

## 9. Automatic screenshot and per-selection crops

When a capturer is configured the widget captures the full page once at pick start and cuts an outlined crop per selection. Visual reference is cheap and valuable for both humans and vision models. The capturer is injected (`screenshot: () => Promise<Blob>`) so the packages have no dependency on `modern-screenshot` or html2canvas.

## 10. Optimistic send with a cancel window instead of a review step

Most reports are a single selection plus a sentence. The popover's Send (or Enter) therefore queues the send and shows a "Sending…" card with a draining bar (`sendDelay`, default 5 s). Cancel keeps the draft, Edit opens the full panel where the prompt and JSON preview still live. The panel's own Send is immediate because opening the panel is already the deliberate path.

## 11. E2E as plain Playwright scripts, not a test framework

The suites are Node scripts with a tiny `assert` helper, run against the dev server with the system Chrome. This keeps the dev dependency to `playwright-core` with no browser download and makes the scripts readable as step-by-step walkthroughs of the UI. Revisit if the suite count grows past a handful.
