---
"@lightback/source": minor
---

Add original-template source stamping for Vue and Svelte. `@lightback/source/vue` provides a Vite pre-plugin and `transformVueSource`; `@lightback/source/svelte` provides a Svelte 5 markup preprocessor and `transformSvelteSource`. Both preserve explicit source attributes, append stamps after spreads, emit project-relative one-based coordinates and retain source maps. Compiler peers are optional and loaded only by their respective entries; existing JSX adapters keep their behavior.

Configure matching adapters on server and client. Vue supports inline HTML templates and a custom-element predicate; external and non-HTML templates are skipped. Put the Svelte preprocessor before other template transformations. Native elements inside Svelte blocks and snippets are supported; dynamic/raw markup and component metadata remain outside stamping. Production browser fixtures verify hydration and exact coordinates reaching feedback payloads and prompts.
