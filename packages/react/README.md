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

`useLightback()` returns the client. `useLightbackWidget()` returns the mounted handle, or null before mount. Use `widget={false}` for your own UI. Widget options are read on mount; `context` is merged whenever it changes.

Imports and client creation are SSR-safe. Create a browser client at application startup to collect browser activity; do not share per-user server context between requests.

Supports evergreen browsers from the last two years, Safari 15.4+, and Node 18+ for imports. Built to ES2020.

[Full documentation and examples](https://github.com/aleandros/lightback#readme). MIT licensed.
