---
"@lightback/widget": patch
"@lightback/react": minor
---

Add a lightweight `@lightback/widget/lazy` entry and lazy standalone script that load the editor and picker on first interaction. Preserve collectors, customization and host identity, coalesce concurrent activation, cancel pending activation on close/destroy, and retry failed native imports with a fresh asset URL.

The React provider now mounts the lazy trigger by default. Its handle exposes promise-returning `open()` and `startPicking()` methods. The eager `mountWidget()` and standalone bundle remain available.
