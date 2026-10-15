# @lightback/widget

Lightback's framework-agnostic feedback UI: point at an element or drag an area, add comments, review context and send to your backend. Uses Shadow DOM and depends only on core.

```sh
npm install @lightback/core @lightback/widget
```

```ts
import { createLightback } from '@lightback/core';
import { mountWidget } from '@lightback/widget';

const client = createLightback({ endpoint: '/api/feedback' });
const widget = mountWidget({ client }); // Run after the browser DOM is ready.
// On teardown: widget.destroy(); client.destroy();
```

Provide `screenshot: ({ area }) => Promise<Blob | null>` to enable screenshots and selection crops. Use `domCapturer` with a DOM renderer and `screenshotArea: 'viewport'` to keep long-page captures small. Hidden subtrees are excluded from both DOM cloning and the automatic 8,000-element budget in either capture mode. After an automatic skip or failure, Screenshot stays highlighted until an image is attached. Sending without a screenshot or crops offers Add screenshot (capture and keep editing) or Send anyway (remembered for retries of that draft). Localize these with `strings.missingScreenshot`, `strings.addScreenshot`, and `strings.sendAnyway`. The package includes no screenshot library. `sendDelay` controls the inline send cancel window (default 5000 ms).

For script tags, serve `dist/lightback.iife.js` and call `Lightback.createLightback()` and `Lightback.mountWidget()`. This standalone bundle includes core. ESM and CommonJS imports are safe during SSR; mounting requires a browser.

Supports evergreen browsers from the last two years, Safari 15.4+, and Node 18+ for imports. Built to ES2020.

[Full documentation and examples](https://github.com/aleandros/lightback#readme). MIT licensed.

## Customization

Pass `strings: Partial<WidgetStrings>` to translate labels and status messages; omitted entries use exported `defaultStrings`. Dynamic counts are functions. `strings.pillOpen` takes precedence over the legacy `triggerLabel`.

Use `theme: 'light' | 'dark' | 'auto'` (default `auto`), `hideTrigger: true` with your own `handle.open()` / `handle.startPicking()` buttons, and CSS `::part(pill)`, `::part(panel)`, `::part(popover)`, `::part(pending)` when the `--lb-*` variables are insufficient. Options are read at mount time.

See the [guides](https://github.com/aleandros/lightback/tree/main/docs/guide) for examples and the payload reference.

## Lazy loading

```ts
import { mountLazyWidget } from '@lightback/widget/lazy';
const widget = mountLazyWidget({ client, hideTrigger: true });
await widget.open(); // or startPicking(); rejection calls onError and can be retried
```

Omit `hideTrigger` for a lightweight pill that loads the UI on first click. Collectors run from client creation. Strings, themes and CSS customization carry through on the same host. Concurrent calls share a load and apply the latest action. Close cancels pending activation; destroy prevents late mounting without destroying the client.

ESM defers `lightback-ui.js` using a `new URL(..., import.meta.url)` asset, tested in Vite production. Deploy the emitted asset. Native import retries use a fresh URL. CommonJS delegates splitting to the consuming bundler. Keep eager imports out of the initial graph to retain the savings.

For script tags, serve `dist/lightback-lazy.iife.js` and `dist/lightback-ui.js` together, then use `Lightback.mountLazyWidget({ client })`. The bootstrap includes core; `widgetUrl` overrides the UI URL if needed. Load one standalone bootstrap per page. Imports are SSR-safe; mounting requires a browser DOM.

## Session recovery (unreleased)

With the new core/widget versions, redacted collector buffers and unfinished reports recover after reload in the same tab. Recovery uses IndexedDB plus a sessionStorage key, defaults to a 30-minute expiry since the last checkpoint and a 5 MiB budget, and clears on successful send or Discard. Set `persistence: false` on `createLightback()` to opt out of recovery storage. Screenshot/crop blobs require `persistence: { attachments: true }` and a capturer that masks sensitive pixels first. Storage failures leave the editor usable in memory. The restored report never resumes a pending send automatically. See the [recovery guide](https://aleandros.github.io/lightback/guide/customization#restore-work-after-reload) for retention, cleanup, limits and custom-editor APIs.
