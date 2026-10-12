---
"@lightback/core": patch
"@lightback/widget": patch
---

Fix recovery and send races found by generated stateful tests: clear wins over a pending database open, recovered timestamps are sorted before applying smaller buffer limits, metadata-only recovery drops orphaned crop references, and tiny string limits preserve recovery field names. Cancel widget sends discarded or destroyed while waiting for image jobs and ignore late transport callbacks for invalidated widgets.
