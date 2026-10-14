# Vue and Svelte integrations

The wrappers own the widget's lifecycle and provide access to it through framework context. Core and the widget remain framework-agnostic. Both integrations load only the trigger at mount; the full editor loads on first interaction.

## Vue 3.5+

```bash
pnpm add @lightback/core @lightback/widget @lightback/vue
```

Call the provider in an ancestor's synchronous setup:

```vue
<script setup>
import { onUnmounted, ref } from 'vue';
import { createLightback } from '@lightback/core';
import { provideLightback } from '@lightback/vue';
import App from './App.vue';

const client = createLightback({ endpoint: '/api/feedback' });
const context = ref({ route: 'home' });
const { widget } = provideLightback(client, { context });
onUnmounted(() => client.destroy()); // this component owns this client
</script>

<template>
  <App />
  <button @click="widget?.open()">Feedback</button>
</template>
```

Descendants call `useLightback()` for the client and `useLightbackWidget()` for a readonly shallow ref. In script, access `widget.value`; Vue unwraps it in templates. Context accepts a plain object, ref or getter and is watched deeply after mount. For example, `context: () => ({ route: route.fullPath })` follows your router.

## Svelte 5

```bash
pnpm add @lightback/core @lightback/widget @lightback/svelte
```

Call the provider during ancestor component initialization:

```svelte
<script>
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { createLightback } from '@lightback/core';
  import { provideLightback } from '@lightback/svelte';
  import App from './App.svelte';

  const client = createLightback({ endpoint: '/api/feedback' });
  const context = writable({ route: 'home' });
  const { widget } = provideLightback(client, { context });
  onDestroy(() => client.destroy()); // this component owns this client
</script>

<App />
<button onclick={() => $widget?.open()}>Feedback</button>
```

Descendants call `useLightback()` for the client and `useLightbackWidget()` for a readable store. Context accepts a plain snapshot or a readable store; its emissions are merged into the client while mounted. Update the store from an effect when using runes. When client/options come from props, `untrack(() => provideLightback(client, { context, widget }))` makes their initial-value semantics explicit. This package is ESM, like Svelte's runtime; CommonJS applications can use dynamic `import()`.

## Lifecycle and ownership

- The returned widget ref/store is null before mount, after teardown and with `widget: false`. Pass a widget options object for screenshots, strings, theme or `hideTrigger: true`. `open()` and `startPicking()` return promises; handle rejections when using custom controls.
- The client, context source and widget configuration belong to that provider instance. Remount to replace the client, widget options or Svelte context store. Reactive Vue context and Svelte store emissions update without remounting. Context merges rather than replaces: omitted keys remain until explicitly cleared, e.g. `{ user: null }` on logout.
- Unmounting removes the widget, stops context updates and prevents a pending lazy load from mounting later. It does not destroy the client. The application that created the client owns `destroy()`; a shared client can outlive several provider mounts.
- Providers are scoped to their descendants, with the nearest ancestor winning. The provider's return value serves controls in the same component. Helpers throw when there is no provider. Use distinct clients and persistence keys for independent report editors.
- SSR imports and provider initialization do not mount widgets or subscribe to context. Create a client per server request; never share a client singleton across users. Browser clients should start early to collect app activity. Configure both server and client template compilation with the same stamping settings.

## Source locations

Install the optional build-time `@lightback/source` package. Use `@lightback/source/vue` before the Vue Vite plugin, or `@lightback/source/svelte` first in Svelte's preprocess list. Both stamp original opening-tag coordinates and preserve explicit source attributes. See [Source locations](./source-locations.md) for complete setup and limitations.

Svelte selections carry stamped sources but no inferred Svelte component chain or props (`framework` remains null). Vue's existing runtime inspection is best effort; production names and metadata can be absent. Neither wrapper adds a framework dependency to core or the widget.
