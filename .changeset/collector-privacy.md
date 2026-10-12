---
"@lightback/core": patch
---

Redact the complete payload, including page metadata, context, breadcrumbs and embedded URLs/JSON, and keep attachment filenames consistent with redacted references. Exclude editable contents from breadcrumb and inspection text. Omit redirected response bodies unless their final origin is verified as same-origin. Prevent late network completions from refilling cleared or destroyed clients, and preserve independent collectors when multiple clients are destroyed in any order.
