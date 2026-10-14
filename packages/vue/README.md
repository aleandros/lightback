# Lightback for Vue

Vue 3.5+ lifecycle and context helpers. Install `@lightback/core`, `@lightback/widget` and `@lightback/vue`.

```vue
<script setup>
import { createLightback } from '@lightback/core';
import { provideLightback } from '@lightback/vue';
import { onUnmounted, ref } from 'vue';
const client = createLightback({ endpoint: '/api/feedback' });
const context = ref({ route: 'home' });
provideLightback(client, { context });
onUnmounted(() => client.destroy()); // this component owns this client
</script>
<template><RouterView /></template>
```

Call `provideLightback(client, options)` synchronously in an ancestor's setup. In descendants, `useLightback()` returns the client and `useLightbackWidget()` a readonly shallow ref to the lazy handle. Use `widget.value?.open()` in script (Vue unwraps the ref in templates). The provider also returns `{ client, widget }` for its own controls.

The handle is null before mount, after teardown or with `widget: false`. A `widget` options object forwards screenshots, translations, theme and custom-trigger options. Client and widget options are captured at setup; remount to replace them. Context can be a plain object, ref or getter, is watched deeply after mount, and merges through `client.setContext`. Omitted keys are retained; clear a key explicitly when needed.

Unmounting removes the widget and context watcher, including pending lazy activation. It never destroys the caller's client. SSR imports and setup are safe: no widget, context watcher or browser side effects run on the server. Create clients per request in SSR, never in a shared server singleton. Providers are scoped to their descendants; the nearest provider wins.

For original `.vue` element coordinates in production, configure `@lightback/source/vue` before the Vue Vite plugin. See the [integration guide](https://aleandros.github.io/lightback/guide/frameworks) and [source guide](https://aleandros.github.io/lightback/guide/source-locations).
