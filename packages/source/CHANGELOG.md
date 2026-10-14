# @lightback/source

## 0.1.1

### Patch Changes

- Validate React 19 compatibility with real development JSX/TSX inspection and minified client/SSR hydration fixtures. Document best-effort development stack locations and the stamped or manual source fallback when production debug metadata is absent. Retain React 18 coverage; no transform or runtime API changes.

## 0.1.0

### Minor Changes

- b6ba9b8: Add the optional @lightback/source build package with reusable JSX/TSX stamping, Vite and Babel adapters, project-relative paths, include/exclude controls and source maps. Apply identical options in client and SSR builds. Vue and Svelte templates retain the manual data-source fallback.

  Prefer explicit data-source locations over framework debug locations in core, preserving project-relative element locations from the build adapters.
