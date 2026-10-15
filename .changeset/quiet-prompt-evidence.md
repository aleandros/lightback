---
"@lightback/core": patch
---

Rank prompt evidence by failure priority and proximity to the latest captured interaction, with submission time as fallback. Collapse repeated evidence with counts and first/last timestamps without changing the payload. Add an exported PromptOptions type and a configurable overall character budget alongside the existing per-collector group limit, with explicit omission notices and no claims of causality.
