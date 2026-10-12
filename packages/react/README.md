# @lightback/react

Thin React provider and hooks for Lightback's browser feedback client and widget. Requires React 17 or newer.

```sh
npm install @lightback/core @lightback/widget @lightback/react
```

```tsx
import { createLightback } from '@lightback/core';
import { LightbackProvider } from '@lightback/react';

const client = createLightback({ endpoint: '/api/feedback' });

export function Feedback({ children }) {
  return <LightbackProvider client={client}>{children}</LightbackProvider>;
}
```

`useLightback()` returns the client. `useLightbackWidget()` returns a lazy handle, or null before the mounting effect runs. The provider initially mounts only a lightweight trigger; the UI loads on first interaction. Call `await handle.open()` or `await handle.startPicking()` from custom triggers, and set `widget={{ hideTrigger: true }}` to hide the built-in pill. Load failures call `onError` and can be retried by invoking the action again. Use `widget={false}` for your own UI. Widget options are read on mount; `context` is merged whenever it changes.

The ESM widget UI is a separate URL asset; the bundler must emit it (tested in Vite). Keep the emitted asset when deploying. CommonJS splitting depends on your bundler. The provider cleans up its widget even when unmounted during loading; the application owns the client lifetime.

Imports and client creation are SSR-safe. Create a browser client at application startup to collect browser activity; do not share per-user server context between requests.

Supports evergreen browsers from the last two years, Safari 15.4+, and Node 18+ for imports. Built to ES2020.

[Full documentation and examples](https://github.com/aleandros/lightback#readme). MIT licensed.

## Session recovery (unreleased)

With the new core/widget versions, redacted collector buffers and unfinished reports recover after reload in the same tab. Recovery uses IndexedDB plus a sessionStorage key, defaults to a 30-minute expiry since the last checkpoint and a 5 MiB budget, and clears on successful send or Discard. Set `persistence: false` on `createLightback()` to opt out of recovery storage. Screenshot/crop blobs require `persistence: { attachments: true }` and a capturer that masks sensitive pixels first. Storage failures leave the editor usable in memory. The restored report never resumes a pending send automatically. See the [recovery guide](https://aleandros.github.io/lightback/guide/customization#restore-work-after-reload) for retention, cleanup, limits and custom-editor APIs.
