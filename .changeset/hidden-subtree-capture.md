---
"@lightback/widget": patch
---

Prune hidden, boxless subtrees from DOM screenshot cloning and budget estimates in viewport and whole-page modes, preserving display:contents children, native select labels, fixed elements and off-screen layout. Share fixed-element discovery between budget checks and rendering, keeping renderer geometry fresh and custom capturer wrappers intact. Keep the default 8,000-element budget.

Highlight the Screenshot button after an automatic skip or failure. Before sending without screenshots or crops, offer Add screenshot (capture and keep editing) or Send anyway (remembered for retries of the current draft), after image work for the current draft settles; discarded captures do not block a new text-only report. New localizable defaultStrings keys: `missingScreenshot`, `addScreenshot`, `sendAnyway`.
