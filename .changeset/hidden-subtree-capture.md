---
"@lightback/widget": patch
---

Prune hidden, boxless subtrees from DOM screenshot cloning and budget estimates in viewport and whole-page modes, preserving display:contents children, fixed elements and off-screen layout. Keep the default 8,000-element budget.

Highlight the Screenshot button after an automatic skip or failure. Before sending without screenshots or crops, offer Add screenshot (capture and keep editing) or Send anyway (remembered for retries of the current draft), after pending image work settles. New localizable defaultStrings keys: `missingScreenshot`, `addScreenshot`, `sendAnyway`.
