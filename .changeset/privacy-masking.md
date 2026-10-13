---
"@lightback/core": minor
"@lightback/widget": minor
---

Mark sensitive elements with `data-lightback-sensitive` or `privacy.selectors`. Selections, region children, breadcrumbs, previews, prompts and recovery records keep their selector and component names but withhold text, attributes, HTML and component props, and are flagged `sensitive`. Invalid privacy selectors throw.

The widget masks sensitive elements in every screenshot and crop with opaque boxes before anything is previewed, stored or sent, and drops an image it cannot mask. Reporters can hide any other area from the pick bar; earlier crops are re-cut and later captures reuse the mask. Payloads list masks in an optional `masks` field. Region selection now sees elements under existing pins.
