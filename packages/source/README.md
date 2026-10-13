# Lightback source locations

Optional build-time JSX/TSX stamping for production element inspection. No runtime dependency is added to `@lightback/core`, widget or React.

```ts
import lightbackSource from '@lightback/source/vite';
// In Vite's config, before your React plugin:
export default { plugins: [lightbackSource()] };
```

`@lightback/source/babel` exports a Babel plugin for existing Babel pipelines, including Webpack's `babel-loader`. The root entry exports `transformSource(code, filename, options)`, returning `{ code, map }` or `null`. Run before JSX compilation.

All adapters accept `root`, `include` and `exclude`. Globs match slash-separated project-relative paths; default inclusion is `**/*.jsx` and `**/*.tsx`. Vite defaults to its project root; other entries default to cwd. Dependencies, outside-root files and virtual/query modules are skipped. Native tags receive `data-source="src/App.tsx:12:5"` with one-based opening-tag coordinates. Explicit attributes are preserved; generated attributes follow spreads. Source paths become public in the DOM and bundle.

Use identical settings for client and SSR builds to preserve hydration. React JSX/TSX is tested; Vue SFC and Svelte templates require the manual `data-source` fallback. Exclude non-DOM renderer files, such as React Three Fiber scenes. For additional syntax in Vite or `transformSource`, set `parserPlugins` (e.g. `['decorators-legacy']`); the host compiler must support it too. Babel uses its host parser configuration. This does not restore production framework component metadata.

See the [source-location guide](https://aleandros.github.io/lightback/guide/source-locations) for Babel configuration, filtering, source maps and limitations. MIT licensed.
