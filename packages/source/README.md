# Lightback source locations

Optional build-time JSX/TSX, Vue and Svelte template stamping for production element inspection. No runtime dependency is added to `@lightback/core`, widget or React.

```ts
import lightbackSource from '@lightback/source/vite';
// In Vite's config, before your React plugin:
export default { plugins: [lightbackSource()] };
```

`@lightback/source/babel` exports a Babel plugin for existing Babel pipelines, including Webpack's `babel-loader`. The root entry exports `transformSource(code, filename, options)`, returning `{ code, map }` or `null`. Run before JSX compilation.

All adapters accept `root`, `include` and `exclude`. Globs match slash-separated project-relative paths; default inclusion is `**/*.jsx` and `**/*.tsx`. Vite defaults to its project root, the loader to its compiler's `rootContext`, and other entries to cwd. Dependencies, outside-root files and virtual/query modules are skipped. Native tags receive `data-source="src/App.tsx:12:5"` with one-based opening-tag coordinates. Explicit attributes are preserved; generated attributes follow spreads. Source paths become public in the DOM and bundle.

Use identical settings for client and SSR builds to preserve hydration. React 18 and React 19 JSX/TSX are tested with minified client/SSR builds and hydration; Vue SFC and Svelte templates use their dedicated adapters below. Exclude non-DOM renderer files, such as React Three Fiber scenes. For additional syntax in Vite or `transformSource`, set `parserPlugins` (e.g. `['decorators-legacy']`); the host compiler must support it too. Babel uses its host parser configuration. React 19 development inspection also has a real browser fixture. Debug-stack locations are best effort and may refer to transformed modules; stamps retain original source coordinates. Without stamps or manual attributes, production source locations are absent. This does not restore production framework component metadata.

See the [source-location guide](https://aleandros.github.io/lightback/guide/source-locations) for Babel configuration, filtering, source maps and limitations. MIT licensed.

## Next.js

```js
// next.config.mjs
import { withLightbackSource } from '@lightback/source/next';
export default withLightbackSource({ /* existing config */ }, {
  exclude: ['**/*.test.*'],
});
```

Requires Next.js 16. Works in development and production with Turbopack and `--webpack`, on server and client components, without replacing SWC or adding a Babel config. Object and sync/async function configs are supported. Apply this wrapper last; it preserves existing Turbopack rules and webpack hooks while ordering stamping first. Options must be JSON-safe. Set `root` explicitly to the repository root in monorepos; dependencies in `node_modules` remain unstamped even with `transpilePackages`. Source paths are public in the DOM and bundle.

For custom webpack pipelines, `@lightback/source/loader` exports a webpack-compatible loader in ESM and CommonJS. Use `require.resolve('@lightback/source/loader')` with `enforce: 'pre'` before JSX compilation. It defaults `root` to `this.rootContext`, caches transformer setup per options object/root, and passes excluded code/maps through unchanged. See the [guide](https://aleandros.github.io/lightback/guide/source-locations) for filtering and monorepo setup.

## Vue and Svelte

```ts
import lightbackVueSource from '@lightback/source/vue';
// plugins: [lightbackVueSource(), vue()]
import lightbackSvelteSource from '@lightback/source/svelte';
// Svelte config: preprocess: [lightbackSvelteSource({ root: process.cwd() })]
```

The Vue adapter needs `@vue/compiler-sfc` 3.5+; the Svelte preprocessor needs Svelte 5. These optional peers are only loaded by their adapter entries. Both operate on original templates, preserve source maps and explicit attributes, and support `root`, `include` and `exclude`. Defaults include `.vue` or `.svelte` respectively. Apply identical settings to client and server. `transformVueSource` and `transformSvelteSource` are also exported from those entries for custom compiler pipelines.

Vue stamps HTML/SVG, plus custom elements identified by an `isCustomElement` predicate matching the host compiler. It skips components, external templates and non-HTML templates. Svelte stamps regular native elements, including those inside blocks and snippets, but not components or dynamic special elements. Put the Svelte preprocessor first so coordinates remain original. Neither adapter instruments runtime-generated HTML or recovers component metadata. See the [full guide](https://aleandros.github.io/lightback/guide/source-locations).
