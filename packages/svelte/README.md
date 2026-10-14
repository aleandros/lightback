# Lightback for Svelte

Svelte 5 lifecycle and context helpers. Install `@lightback/core`, `@lightback/widget` and `@lightback/svelte`.

```svelte
<script>
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { createLightback } from '@lightback/core';
  import { provideLightback } from '@lightback/svelte';
  import App from './App.svelte';
  const client = createLightback({ endpoint: '/api/feedback' });
  const context = writable({ route: 'home' });
  provideLightback(client, { context });
  onDestroy(() => client.destroy()); // this component owns this client
</script>
<App />
```

Call `provideLightback(client, options)` during ancestor component initialization. Descendants call `useLightback()` for the client and `useLightbackWidget()` for a readable store of the lazy handle. Use `$widget?.open()` in a component; the provider also returns `{ client, widget }` for its own controls.

The handle is null before mount, after teardown or with `widget: false`. A `widget` options object forwards screenshots, translations, theme and custom-trigger options. Client and widget options are captured during initialization; remount to replace them. Context accepts a plain snapshot or a readable store subscribed after mount. Updates merge through `client.setContext`; omitted keys are retained. With runes, update a context store in an effect. When passing initial props, use `untrack(() => provideLightback(client, { context, widget }))` to make the intentional snapshot explicit.

Unmounting removes the widget and context subscription, including pending lazy activation. It never destroys the caller's client. SSR imports and initialization are safe: no widget or context subscription runs on the server. Create clients per request in SSR, never in a shared server singleton. Providers are scoped to their descendants; the nearest provider wins.

For original `.svelte` element coordinates in production, put `@lightback/source/svelte` first in your compiler's preprocess list. Source stamping does not recover Svelte component chains or props; selected elements still carry exact file/line/column locations. See the [integration guide](https://aleandros.github.io/lightback/guide/frameworks) and [source guide](https://aleandros.github.io/lightback/guide/source-locations).
