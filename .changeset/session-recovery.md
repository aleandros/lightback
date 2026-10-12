---
"@lightback/core": minor
"@lightback/widget": minor
"@lightback/react": patch
---

Restore bounded, redacted collector buffers and unfinished drafts after reload using session-scoped IndexedDB. Add expiry/schema handling, a storage opt-out, custom-editor recovery APIs, and explicit opt-in for privacy-safe screenshot/crop blobs. Clear drafts and old context after successful send or discard; keep the editor usable if storage is unavailable.

Restore widget notes and selections without resuming pending sends. Show recovered counts before the lazy UI loads and guard late screenshot jobs after discard or teardown. Exclude form values from inspection snapshots and persisted metadata. Support the compatible core 0.2 API in widget and React peer ranges, retaining memory-only operation with older core versions.
