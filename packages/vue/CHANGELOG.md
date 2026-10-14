# @lightback/vue

## 0.1.0

### Minor Changes

Add Vue 3.5+ and Svelte 5 integrations with `provideLightback`, `useLightback` and `useLightbackWidget`. Mount the lazy widget through framework lifecycle hooks, merge reactive context updates, and dispose widget resources and subscriptions on unmount while leaving the caller's client alive. SSR imports and initialization avoid DOM work and subscriptions. Vue exposes a readonly shallow ref; Svelte exposes a readable store and ships ESM to match its runtime.

Production browser fixtures cover hydration, source locations in sent reports and model prompts, independent providers, repeated mounts, headless usage and unmount during a pending UI download.
