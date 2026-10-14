# Getting started

Lightback adds a feedback widget to your web app. Users point at the thing they mean, write a sentence, and you receive a JSON report with the element's component chain, a screenshot, console output, errors, network calls, breadcrumbs and whatever context you attach. It posts to your own endpoint; there is no account to create.

## Install

```bash
pnpm add @lightback/core @lightback/widget
# Optional screenshots:
pnpm add modern-screenshot
# React users:
pnpm add @lightback/react
```

Packages provide ESM and CommonJS with matching TypeScript types, except `@lightback/svelte`, which is ESM. The framework integrations require widget `0.2`. The widget is a custom element inside a Shadow DOM, so it works with any framework or none.

## Mount it

Create the client once, as early as possible, so the buffers have recent context when a user eventually reports.

```ts
// lightback.ts
import { createLightback } from '@lightback/core';
import { mountLazyWidget, domCapturer } from '@lightback/widget/lazy';

export const lightback = createLightback({
  endpoint: '/api/feedback',
  context: { release: import.meta.env.VITE_RELEASE },
});

const widget = mountLazyWidget({
  client: lightback,
  screenshotArea: 'viewport',
  screenshot: domCapturer((root, options) => import('modern-screenshot').then((m) => m.domToBlob(root, options))),
});
```

Import `lightback.ts` from your entry file. Install `modern-screenshot` for the example above, or omit `screenshot` for reports without images. The capturer is optional and injectable: `domCapturer` adapts DOM-cloning libraries, and any function that returns a `Promise<Blob>` of the requested area works. Viewport captures stay fast on long pages; see [Screenshot capturer](./customization.md#screenshot-capturer).

### React

```tsx
import { LightbackProvider } from '@lightback/react';
import { createLightback } from '@lightback/core';
import { domCapturer } from '@lightback/widget/lazy';
const screenshot = domCapturer((root, options) => import('modern-screenshot').then((m) => m.domToBlob(root, options)));
// In the React integration, let the provider mount the widget.
const lightback = createLightback({ endpoint: '/api/feedback' });

<LightbackProvider client={lightback} widget={{ screenshot, screenshotArea: 'viewport' }} context={{ user: { id: user.id } }}>
  <App />
</LightbackProvider>
```

`context` is pushed into every report whenever it changes. `useLightback()` returns the client, `useLightbackWidget()` the lazy widget handle. The provider mounts only the trigger; clicking it or calling `await widget.open()` / `await widget.startPicking()` loads the editor and picker. `widget={false}` disables the widget entirely.

### Vue and Svelte

Install `@lightback/vue` for Vue 3.5+ or `@lightback/svelte` for Svelte 5. Their `provideLightback` helpers mount the lazy widget and share it with descendants through framework context. See the [integration guide](./frameworks.md) for setup, reactive context, SSR and cleanup.

### SSR and script tags

All packages can be imported on Node 18+; `createLightback()` leaves server globals untouched and returns empty browser environment defaults. Create the browser client at app startup, and call `mountLazyWidget()` (or the eager `mountWidget()`) only after the DOM is ready (for example in a client effect). The React provider mounts in an effect itself; do not also mount a second widget manually. DOM inspection APIs throw a clear error on the server.

For a bundler-free integration, serve the built `packages/widget/dist/lightback.iife.js` and call `Lightback.createLightback({ endpoint: '/api/feedback' })`, then `Lightback.mountWidget({ client })`. Core is included in that script. Supported browsers are evergreen releases from the last two years and Safari 15.4+; builds target ES2020.

### Loading and retries

The lazy handle exists immediately, with a stable `element` for host styling. All widget options are forwarded to the UI when it loads, including translations, themes, screenshots and `hideTrigger`. For a custom trigger, set `hideTrigger: true` and call `open()` or `startPicking()`; await the returned promise if your app needs to wait for readiness. A rejected load calls `onError`; invoking the action again retries. The built-in trigger displays `strings.loading` and `strings.loadFailed` and stays clickable.

Repeated interactions share one download, then apply the latest requested action once. `close()` cancels pending activation. `destroy()` removes the trigger and prevents a pending download from mounting UI. Neither destroys the client, so collection continues until you call `client.destroy()`.

The ESM package defers a self-contained `lightback-ui.js` asset. Your bundler must copy `new URL('./asset.js', import.meta.url)` assets (the production Vite demo tests this). Deploy the emitted asset alongside the app. CommonJS delegates splitting to your bundler. Avoid also importing the eager entry if you want the initial JavaScript reduction.

For a lazy script-tag install, serve `dist/lightback-lazy.iife.js` and `dist/lightback-ui.js` together, then call `Lightback.mountLazyWidget({ client })`. The bootstrap includes core and locates the UI relative to its script URL; `widgetUrl` overrides the location. Serve the UI as JavaScript, with module CORS headers if cross-origin. Load either the eager or lazy standalone bootstrap, not both. Failed native imports use a fresh query parameter on retry.

## First report

1. Click **Point at something** on the pill.
2. Click a button, or drag a rectangle over an area.
3. Type a sentence in the comment box and press Enter.

A "Sending feedback…" card gives five seconds to cancel or edit. With a capturer configured, the report posts to `/api/feedback` as `multipart/form-data` with a `payload` JSON field and one PNG per screenshot and crop. Without images it sends JSON. See [Backend](./backend.md) for the contract.

## What arrived

The payload for that single click looks like this, trimmed:

```json
{
  "version": 1,
  "note": { "text": "" },
  "selections": [{
    "kind": "element",
    "selector": "tr:nth-of-type(3) > td:nth-of-type(5) > button",
    "components": ["InvoiceRow", "InvoiceTable", "Dashboard", "App"],
    "source": { "file": "src/Dashboard.tsx", "line": 177, "column": 9 },
    "props": { "invoice": { "id": "INV-1044", "status": "overdue" } },
    "note": "Retry does nothing after the 500.",
    "crop": "selection-1.png"
  }],
  "errors": [], "network": [{ "method": "POST", "url": "/api/pay", "status": 500 }],
  "console": [], "breadcrumbs": [], "env": {}, "context": { "release": "1.4.2" }
}
```

`toPromptContext(payload)` from `@lightback/core` renders the same report as markdown for a language model. Pair it with `screenshot.png` for a vision-capable model.

Call `widget.destroy()` and `lightback.destroy()` when an integration is unmounted permanently. The React provider cleans up its widget; the application owns the client lifetime.

## Next

- [Customization](./customization.md): colours, position, theme, your own trigger.
- [Privacy and masking](./privacy.md): keep account, payment or personal data out of reports and screenshots.
- [Backend](./backend.md): receive, store and triage reports.
- [Texts and i18n](./texts-and-i18n.md): change every label.

## Reload recovery

Session recovery is enabled by default. Report text, selections, notes and recent collector buffers survive reloads in the current tab for up to 30 minutes since the last checkpoint. Send or Discard clears the draft and old buffers. Restored reports wait for the user to send them. Screenshot persistence is a separate opt-in; only [masked images](./privacy.md) are stored. Set `persistence: false` on `createLightback()` to disable recovery storage. See [retention, privacy and custom-editor APIs](./customization.md#restore-work-after-reload). The demo inbox stores sent reports separately.
