# Getting started

Lightback adds a feedback widget to your web app. Users point at the thing they mean, write a sentence, and you receive a JSON report with the element's component chain, a screenshot, console output, errors, network calls, breadcrumbs and whatever context you attach. It posts to your own endpoint; there is no account to create.

## Install

```bash
pnpm add @lightback/core @lightback/widget
# React users:
pnpm add @lightback/react
```

Packages are ESM and CommonJS, with TypeScript types. The widget is a custom element inside a Shadow DOM, so it works with any framework or none.

## Mount it

Create the client once, as early as possible, so the buffers are already full of context when a user eventually reports.

```ts
// lightback.ts
import { createLightback } from '@lightback/core';
import { mountWidget } from '@lightback/widget';

export const lightback = createLightback({
  endpoint: '/api/feedback',
  context: { release: import.meta.env.VITE_RELEASE },
});

mountWidget({
  client: lightback,
  screenshot: () => import('modern-screenshot').then((m) => m.domToBlob(document.documentElement)),
});
```

Import `lightback.ts` from your entry file. The screenshot capturer is optional and injectable: pass any function that returns a `Promise<Blob>` of the page.

### React

```tsx
import { LightbackProvider } from '@lightback/react';
import { lightback } from './lightback';

<LightbackProvider client={lightback} widget={{ screenshot }} context={{ user: { id: user.id } }}>
  <App />
</LightbackProvider>
```

`context` is pushed into every report whenever it changes. `useLightback()` returns the client, `useLightbackWidget()` the widget handle.

## First report

1. Click **Point at something** on the pill.
2. Click a button, or drag a rectangle over an area.
3. Type a sentence in the comment box and press Enter.

A "Sending feedback…" card gives five seconds to cancel or edit. Then the report posts to `/api/feedback` as `multipart/form-data` with a `payload` JSON field and one PNG per screenshot and crop. See [Backend](./backend.md) for the contract.

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

## Next

- [Customization](./customization.md): colours, position, theme, your own trigger.
- [Backend](./backend.md): receive, store and triage reports.
- [Texts and i18n](./texts-and-i18n.md): change every label.
