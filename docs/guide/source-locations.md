# Source locations in production

`@lightback/source` is an optional **build-time** package. It stamps native JSX, Vue and Svelte template tags with `data-source="src/App.tsx:12:5"`, so Lightback can locate selected elements without React debug metadata or production source maps. The runtime packages have no dependency on it.

```bash
pnpm add -D @lightback/source
```

## Vite

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import lightbackSource from '@lightback/source/vite';

export default defineConfig({
  plugins: [lightbackSource({ exclude: ['**/*.test.*', '**/generated/**'] }), react()],
});
```

Place the adapter before framework plugins. It runs before JSX compilation in development, production and SSR. `root` defaults to Vite's resolved project root; set it explicitly to a shared repository root when server and client builds have different roots. The production playground uses this adapter.

## Next.js

For Next.js 16, wrap your config once. This applies the same stamping settings to server and client components in development and production, with Turbopack or `--webpack`, while keeping Next's SWC compiler:

```js
// next.config.mjs
import { withLightbackSource } from '@lightback/source/next';

export default withLightbackSource({ /* existing Next config */ }, {
  exclude: ['**/*.test.*', '**/generated/**'],
});
```

Config functions, including async `(phase, context) => config` functions, are supported. Apply this wrapper last around other config wrappers so it can order stamping before their loaders. Existing Turbopack rules (including loader-list shorthand) and webpack hooks are preserved. The wrapper adds a leading Turbopack rule without reordering overlapping host rules and adds a webpack `enforce: 'pre'` loader that executes before other pre loaders. Next 15 uses an older rule format and is not supported by this wrapper.

The loader defaults `root` to the compiler's `rootContext`. In a monorepo, set `root` explicitly to the repository root so both bundlers produce the same repository-relative paths, and configure `turbopack.root` to include linked workspace sources if necessary. The two options have different purposes: the former defines stamp paths, the latter controls Turbopack's file resolution. Files in `node_modules`, including packages in `transpilePackages`, remain unstamped. Linked workspace source outside `node_modules` can be stamped when it lies within `root` and matches `include`.

`root`, `include`, `exclude` and `parserPlugins` must contain only JSON values; functions, regexes, `undefined`, cycles and non-finite numbers are rejected. The default includes `.jsx` and `.tsx`. Custom `include` globs can opt into other supported JavaScript/TypeScript extensions; the shared filter still decides which files are stamped. As with all adapters, project paths become public in the DOM and bundle.

`@lightback/source/loader` is also available for custom webpack pipelines. Resolve it to an absolute path with `require.resolve('@lightback/source/loader')`, run it as a pre loader before JSX compilation, and supply the same options on client and server. It returns code and a source map through the loader callback; excluded files retain their input code and map. No Babel config is needed.

Source maps remain controlled by Next; use `productionBrowserSourceMaps: true` if you want published browser maps. When maps are requested, the loader also embeds its map inline because Turbopack does not forward callback maps between separate rule items. Subsequent custom loaders that rewrite source must consume that inline map and return a composed map; for additional rule items, preserve it inline too (for Babel transforms, `sourceMaps: 'both'`). The last map must identify its generated module in `map.file` (for example `Counter.tsx`), which Turbopack uses when combining production modules. The fixture checks this with a loader that shifts lines after stamping. webpack chains callback maps normally.

## Babel and Webpack

The Babel adapter uses the same stamping visitor and path rules. Register it before plugins that lower JSX, alongside your existing React/TypeScript presets:

```js
// babel.config.cjs — also used by Webpack's babel-loader
module.exports = {
  presets: ['@babel/preset-react', '@babel/preset-typescript'],
  plugins: [['@lightback/source/babel', {
    root: __dirname,
    exclude: ['**/*.test.*', '**/generated/**'],
  }]],
};
```

In Webpack, apply `babel-loader` to the original JSX/TSX files. An earlier loader that has already removed JSX leaves nothing to stamp. Existing Babel pipelines can keep this plugin; pipelines without Babel can use `@lightback/source/loader` as described above. Configure both client and server compilation identically. The Babel adapter uses the host parser and preserves the host's source-map chain.

For a custom build pipeline, call `transformSource(code, filename, options)` from `@lightback/source` **before** JSX lowering. It returns `{ code, map }`, or `null` for excluded files. Chain the returned source map into the next compiler; map filenames resolve relative to the transformed module. This API and the Vite adapter parse JSX and TypeScript. Configure additional syntax explicitly, for example `lightbackSource({ parserPlugins: ['decorators-legacy'] })` for legacy decorators. This only enables parsing; the host compiler must also support that syntax. The Babel adapter uses the host's parser configuration instead.

## Vue templates

```ts
// vite.config.ts
import vue from '@vitejs/plugin-vue';
import lightbackVueSource from '@lightback/source/vue';
export default {
  plugins: [lightbackVueSource(), vue()],
};
```

Install `@vue/compiler-sfc` 3.5+ alongside the adapter (normally supplied by Vue). The pre-transform reads the original SFC AST before Vue compiles it and returns a high-resolution source map. Native HTML and SVG tags are stamped; component tags, slots and structural `<template>` nodes are skipped. If your compiler treats custom tags as native, pass the same `isCustomElement` predicate to `lightbackVueSource` and Vue's `template.compilerOptions`. Without it, unknown tags remain components and are not stamped.

Vue's explicitly bound `:data-source`, `v-bind:data-source`, and legacy equivalents are preserved, as are static attributes. Generated attributes follow `v-bind` spreads. HTML templates inside `.vue` files are supported; external `<template src>` and non-HTML languages such as Pug are skipped. For another build pipeline, call `transformVueSource(code, filename, options)` from the same entry before SFC compilation, preserving its returned map.

## Svelte templates

```js
// svelte.config.js — also used by SvelteKit
import lightbackSvelteSource from '@lightback/source/svelte';
export default {
  preprocess: [lightbackSvelteSource({ root: process.cwd() })],
};
```

With plain Vite, configure `svelte({ preprocess: [lightbackSvelteSource({ root })] })` in `@sveltejs/vite-plugin-svelte`. Svelte 5 is required. Put stamping **first**, before preprocessors that change template offsets. Native elements inside conditionals, loops, snippets and component children are stamped, including SVG and custom elements. Components and special elements such as `<svelte:element>` are not stamped themselves; their statically written native children are. Raw HTML inserted with `{@html}` has no original element coordinates. Existing static or expression source attributes are preserved; generated stamps follow spreads.

`transformSvelteSource(code, filename, options)` is available from the same entry for custom pipelines. Both template transforms return `{ code, map }`, or `null` for skipped inputs. The Svelte preprocessor leaves missing filenames untouched. Template syntax must be parseable by the framework compiler at this stage; arbitrary markup languages need their own source-aware integration. The Vue/Svelte compiler peers are optional for JSX users and only loaded by their respective adapter entries.

## Supported inputs

| Input | Initial support |
| --- | --- |
| React `.jsx` / `.tsx` | Vite, Babel and Next.js 16; tested with minified client/SSR output and hydration, including Next server/client components with Turbopack and webpack |
| Non-DOM React renderers (for example React Three Fiber) | Exclude these files, e.g. `exclude: ['src/scene/**']`; lowercase renderer elements may reject DOM attributes |
| JSX in `.js`, `.mjs`, `.cjs` | Opt in with `include`; host compiler must also accept JSX there |
| Other JSX runtimes | Native-tag syntax is stamped; framework/compiler behavior is not covered by the initial fixtures |
| Vue `.vue` HTML templates | Vue Vite adapter or `transformVueSource`; minified client/SSR and browser hydration fixtures |
| Svelte 5 `.svelte` templates | Compiler preprocessor or `transformSvelteSource`; minified client/SSR and browser hydration fixtures |
| Plain HTML | Manual `data-source` |

Vue and Svelte adapters operate at original template offsets, before client/SSR code generation. Processing their generated JavaScript would point to generated code and would miss or misplace template locations. The JSX adapters therefore skip these files and framework virtual modules.

## Paths, filtering and attribute behavior

- `include` and `exclude` accept a glob string or array, matched against slash-separated paths relative to `root`. Default inclusion is `['**/*.jsx', '**/*.tsx']` for JSX, `['**/*.vue']` for Vue and `['**/*.svelte']` for Svelte; `include: []` disables stamping. Exclusion wins. To include JavaScript too, use `include: ['src/**/*.{jsx,tsx,js}']`.
- Files outside `root`, `node_modules`, `.git`, virtual modules and IDs with query/hash suffixes are always skipped. No automatic stripping of query suffixes: `?raw` imports must stay raw. Generated directories inside the root should be excluded explicitly.
- Stamps contain project-relative paths, never the developer's absolute project directory. Lines and columns are one-based, pointing at the opening `<` in the original source. Columns count UTF-16 code units, as JavaScript parsers do. Windows separators become `/`.
- In JSX, native tags, SVG and lowercase custom elements are stamped. Components (`<Button>`, `<UI.Button>`), fragments and namespaced tags are not. A component's rendered native tags carry their own source locations, without requiring prop forwarding.
- Explicit `data-source` or legacy `data-lb-source` attributes are preserved. Otherwise the generated attribute follows spreads and wins over a spread's `data-source`. Running the transform twice does not duplicate stamps.
- Lightback prefers a stamp over framework debug metadata for the selected element. Component-chain source locations still come from framework internals, and may be absent or absolute in development. Stamping does not restore production component props, component call sites or readable component names. Svelte selections retain `framework: null` and an empty chain; their stamped source still appears in the payload and model prompt.

Source paths are visible in the DOM and shipped JavaScript. Use a narrow `include` or omit the plugin from **both** builds if repository layout should not be exposed. This guarantee concerns generated stamps and their source-map filenames; it does not sanitize existing manual attributes or unrelated compiler metadata.

## SSR and hydration

Use the same root, filters and adapter on server and client. Both sides then emit identical attributes, with no runtime code or DOM mutation. Enabling stamping on only one side, or compiling different source revisions, can cause hydration differences. Production fixtures verify matching server/client markup, reuse of the server-rendered DOM and no recoverable hydration errors.

## React development metadata

React 18 `_debugSource` and React 19 `_debugStack` inspection are best effort. A real React 19 development fixture exercises JSX/TSX element locations, nested component call sites and props across the CI browser matrix. Stack locations may describe transformed modules rather than original JSX coordinates, or be absent when browser optimizations such as WebKit tail calls remove the application frame; generated stamps take precedence and retain original opening-tag coordinates.

Production fixtures verify that source locations are absent without stamped or manual attributes, while element inspection continues to work. Component names may be minified and component call-site locations may be absent. Lightback does not require React debug internals or add a React runtime dependency to core.

## Manual fallback

Any framework or template can write the existing attribute directly:

```html
<button data-source="src/PaymentForm.vue:28:5">Pay</button>
```

The runtime also accepts `data-lb-source`, and locations with only a filename or filename/line. Manual locations must be maintained when source lines move. Payload version remains 1.
