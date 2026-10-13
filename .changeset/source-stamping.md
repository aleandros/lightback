---
"@lightback/core": patch
"@lightback/source": minor
---

Add the optional @lightback/source build package with reusable JSX/TSX stamping, Vite and Babel adapters, project-relative paths, include/exclude controls and source maps. Apply identical options in client and SSR builds. Vue and Svelte templates retain the manual data-source fallback.

Prefer explicit data-source locations over framework debug locations in core, preserving project-relative element locations from the build adapters.
