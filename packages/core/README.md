# @lightback/core

Lightback captures feedback context in the browser: console, errors, requests, breadcrumbs, element/component details and a versioned JSON payload. Zero runtime dependencies.

```sh
npm install @lightback/core
```

```ts
import { createLightback, toPromptContext } from '@lightback/core';

const client = createLightback({ endpoint: '/api/feedback' });
const payload = await client.send({ text: 'The payment failed' });
if (payload) console.log(toPromptContext(payload));
// Call client.destroy() when the integration is removed.
```

Collectors do nothing during SSR; DOM inspection requires a browser. Network bodies are opt-in. Input values are never recorded. Supply `send` for a custom transport or `beforeSend` to edit/veto a report.

Supports evergreen browsers from the last two years, Safari 15.4+, and Node 18+ for imports. Built to ES2020.

[Full documentation and examples](https://github.com/aleandros/lightback#readme). MIT licensed.

## Session recovery (unreleased)

With the new core/widget versions, redacted collector buffers and unfinished reports recover after reload in the same tab. Recovery uses IndexedDB plus a sessionStorage key, defaults to a 30-minute expiry since the last checkpoint and a 5 MiB budget, and clears on successful send or Discard. Set `persistence: false` on `createLightback()` to opt out of recovery storage. Screenshot/crop blobs require `persistence: { attachments: true }` and a capturer that masks sensitive pixels first. Storage failures leave the editor usable in memory. The restored report never resumes a pending send automatically. See the [recovery guide](https://aleandros.github.io/lightback/guide/customization#restore-work-after-reload) for retention, cleanup, limits and custom-editor APIs.
