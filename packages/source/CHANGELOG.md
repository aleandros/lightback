# @lightback/source

## 0.3.0

### Minor Changes

- 7dd97a8: Add `withLightbackSource` from `@lightback/source/next` and a reusable `@lightback/source/loader` for original JSX/TSX source stamping in Next.js 16 with Turbopack and webpack. Preserve existing config hooks and rules, apply the same options to server/client builds, and exclude dependencies.

## 0.2.0

### Minor Changes

- 0826db1: Add original-template source stamping for Vue and Svelte. `@lightback/source/vue` provides a Vite pre-plugin and `transformVueSource`; `@lightback/source/svelte` provides a Svelte 5 markup preprocessor and `transformSvelteSource`. Both preserve explicit source attributes, append stamps after spreads, emit project-relative one-based coordinates and retain source maps. Compiler peers are optional and loaded only by their respective entries; existing JSX adapters keep their behavior.

  Configure matching adapters on server and client. Vue supports inline HTML templates and a custom-element predicate; external and non-HTML templates are skipped. Put the Svelte preprocessor before other template transformations. Native elements inside Svelte blocks and snippets are supported; dynamic/raw markup and component metadata remain outside stamping. Production browser fixtures verify hydration and exact coordinates reaching feedback payloads and prompts.

## 0.1.1

### Patch Changes

- Validate React 19 compatibility with real development JSX/TSX inspection and minified client/SSR hydration fixtures. Document best-effort development stack locations and the stamped or manual source fallback when production debug metadata is absent. Retain React 18 coverage; no transform or runtime API changes.

## 0.1.0

### Minor Changes

- b6ba9b8: Add the optional @lightback/source build package with reusable JSX/TSX stamping, Vite and Babel adapters, project-relative paths, include/exclude controls and source maps. Apply identical options in client and SSR builds. Vue and Svelte templates retain the manual data-source fallback.

  Prefer explicit data-source locations over framework debug locations in core, preserving project-relative element locations from the build adapters.
