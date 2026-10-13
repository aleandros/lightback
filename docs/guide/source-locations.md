# Source locations in production

`@lightback/source` is an optional **build-time** package. It stamps native JSX tags with `data-source="src/App.tsx:12:5"`, so Lightback can locate selected elements without React debug metadata or production source maps. The runtime packages have no dependency on it.

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

In Webpack, apply `babel-loader` to the original JSX/TSX files. An earlier loader that has already removed JSX leaves nothing to stamp. No Webpack-specific loader is needed; configure both client and server compilation with the same Babel plugin/options. The Babel adapter uses the host parser and preserves the host's source-map chain.

For a custom build pipeline, call `transformSource(code, filename, options)` from `@lightback/source` **before** JSX lowering. It returns `{ code, map }`, or `null` for excluded files. Chain the returned source map into the next compiler; map filenames resolve relative to the transformed module. This API and the Vite adapter parse JSX and TypeScript. Configure additional syntax explicitly, for example `lightbackSource({ parserPlugins: ['decorators-legacy'] })` for legacy decorators. This only enables parsing; the host compiler must also support that syntax. The Babel adapter uses the host's parser configuration instead.

## Supported inputs

| Input | Initial support |
| --- | --- |
| React `.jsx` / `.tsx` | Vite and Babel; tested with minified React 18 client/SSR output and hydration |
| Non-DOM React renderers (for example React Three Fiber) | Exclude these files, e.g. `exclude: ['src/scene/**']`; lowercase renderer elements may reject DOM attributes |
| JSX in `.js`, `.mjs`, `.cjs` | Opt in with `include`; host compiler must also accept JSX there |
| Other JSX runtimes | Native-tag syntax is stamped; framework/compiler behavior is not covered by the initial fixtures |
| Vue `.vue` templates | No adapter yet; use manual `data-source` |
| Svelte `.svelte` templates | No adapter yet; use manual `data-source` |
| Plain HTML | Manual `data-source` |

Vue and Svelte need template-compiler integration at original template offsets, before client/SSR code generation. Processing their generated JavaScript would point to generated code and would miss or misplace template locations. The JSX adapters therefore skip these files and framework virtual modules.

## Paths, filtering and attribute behavior

- `include` and `exclude` accept a glob string or array, matched against slash-separated paths relative to `root`. Default inclusion is `['**/*.jsx', '**/*.tsx']`; `include: []` disables stamping. Exclusion wins. To include JavaScript too, use `include: ['src/**/*.{jsx,tsx,js}']`.
- Files outside `root`, `node_modules`, `.git`, virtual modules and IDs with query/hash suffixes are always skipped. No automatic stripping of query suffixes: `?raw` imports must stay raw. Generated directories inside the root should be excluded explicitly.
- Stamps contain project-relative paths, never the developer's absolute project directory. Lines and columns are one-based, pointing at the opening `<` in the original source. Columns count UTF-16 code units, as JavaScript parsers do. Windows separators become `/`.
- Native tags, SVG and lowercase custom elements are stamped. Components (`<Button>`, `<UI.Button>`), fragments and namespaced tags are not. A component's rendered native tags carry their own source locations, without requiring prop forwarding.
- Explicit `data-source` or legacy `data-lb-source` attributes are preserved. Otherwise the generated attribute follows spreads and wins over a spread's `data-source`. Running the transform twice does not duplicate stamps.
- Lightback prefers a stamp over framework debug metadata for the selected element. Component-chain source locations still come from framework internals, and may be absent or absolute in development. Stamping does not restore production component props, component call sites or readable component names.

Source paths are visible in the DOM and shipped JavaScript. Use a narrow `include` or omit the plugin from **both** builds if repository layout should not be exposed. This guarantee concerns generated stamps and their source-map filenames; it does not sanitize existing manual attributes or unrelated compiler metadata.

## SSR and hydration

Use the same root, filters and adapter on server and client. Both sides then emit identical attributes, with no runtime code or DOM mutation. Enabling stamping on only one side, or compiling different source revisions, can cause hydration differences. Production fixtures verify matching server/client markup, reuse of the server-rendered DOM and no recoverable hydration errors.

## Manual fallback

Any framework or template can write the existing attribute directly:

```html
<button data-source="src/PaymentForm.vue:28:5">Pay</button>
```

The runtime also accepts `data-lb-source`, and locations with only a filename or filename/line. Manual locations must be maintained when source lines move. Payload version remains 1.
