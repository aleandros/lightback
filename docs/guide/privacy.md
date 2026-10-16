# Privacy and masking

Some parts of a page must never reach a report: account details, payment fields, health data, other customers' names. Lightback can withhold them in two ways.

- **Sensitive elements**, marked by the host, are withheld from the data and masked in every image automatically.
- **Hidden areas**, chosen by the reporter in pick mode, are masked in every image.

Masks are opaque boxes, not blur. Blurred text can sometimes be reconstructed; a solid fill cannot.

## Mark sensitive elements

Add the attribute, or pass selectors to the client. Both apply to the element and everything inside it.

```html
<div class="account" data-lightback-sensitive>dana@example.com · •••• 4242</div>
```

```ts
const lightback = createLightback({
  endpoint: '/api/feedback',
  privacy: { selectors: ['.payment-form input', '[data-private]', '.billing .card-number'] },
});
```

Selectors are matched against the live document whenever an element is described or a screenshot is taken, so content rendered later, or marked later, is covered too. Ancestor context works (`.billing .card-number`). An invalid selector makes `createLightback()` throw, rather than silently protecting nothing.

`SENSITIVE_ATTR` (`'data-lightback-sensitive'`) is exported from `@lightback/core`. `client.isSensitive(el)` tells whether an element is covered.

## What is withheld

| Where | Sensitive element itself (or a descendant of one) | Ancestor containing sensitive content |
| --- | --- | --- |
| Selection `text` | Empty | Sensitive descendants removed; the rest kept |
| Selection `attrs`, `classes` | Empty | Unchanged (the ancestor's own) |
| Selection `html` | Omitted | Each sensitive descendant becomes an empty, attribute-free placeholder: `<p data-lightback-sensitive></p>` |
| Selection `props` | Omitted | Omitted when the nearest component renders any sensitive element, because its props are probably the data source |
| Region children | `text` and `role` empty, `sensitive: true` | Text without sensitive descendants |
| Breadcrumbs | Click recorded as the short selector only | Click text without sensitive descendants |
| Screenshot and crops | Opaque box over the element, including overflowing content | Only the sensitive part is masked |

What remains is what locates the element: `selector`, `tag`, `elementId`, rects, component names and source locations. Selections and region children carry `sensitive: true`, and the prompt says "Sensitive: content withheld by the app", so a model knows the absence is deliberate.

**Do not put sensitive data in `id` or `data-testid` values.** They are structural and appear in selectors.

The rules apply before anything is stored, previewed or sent: the panel's Prompt and JSON preview, session recovery records, `beforeSend` and the transport all see the withheld version.

### Component props

React props come from the nearest named component above the element. Lightback walks that component's rendered fiber subtree, including portals; if any host element in it is sensitive, the props are omitted. Vue components are checked through their rendered roots; fragments (`v-for`, `v-if`, `<template>`) and fragment-rooted child components are searched through their children. Unknown roots, and trees larger than 5000 nodes, count as sensitive. When nothing on the page is sensitive the check is skipped.

Image annotations are drawn over masked source images. Undo and Reset marks remove only annotations; they cannot restore sensitive pixels or remove selection outlines. Annotation strokes are not privacy masks.

## Screenshot masking

With a `screenshot` capturer configured, the widget masks every capture before it becomes an attachment, a preview, a crop or a recovery record:

1. Sensitive rects are measured just before and just after the capturer runs. Content that appears, moves or becomes sensitive during an asynchronous capture is still covered.
2. The capturer's image is decoded and drawn to a canvas. Opaque boxes are painted over each sensitive rect and each hidden area, with a 2 CSS-pixel bleed against antialiasing.
3. The masked PNG replaces the original. The unmasked blob and bitmap are released; crops are cut from the masked canvas only.

If masking cannot run (no 2D canvas, or encoding fails), the image is dropped and `onError` is called. An unmasked image is never kept as a fallback.

`payload.masks` lists the boxes painted into the attached images, each with a document rect and a `reason` (`sensitive` or `reporter`). It is present only when images are attached. Up to 300 sensitive and 100 reporter masks are kept, bounded separately so many sensitive matches never evict the reporter's own areas. The prompt summarises them.

## Hidden areas (reporter masks)

When a capturer is configured, the pick bar shows **▨ Hide area** (`data-action="mask-mode"`). While it is on, clicking an element (its box plus any overflowing content) or dragging a rectangle hides that area instead of selecting it. Hidden areas show as hatched boxes while picking. They are painted into the current screenshot at once. Crops that overlap the area are discarded and re-cut, so a failed re-cut leaves no crop rather than a stale one. Every later capture of the same draft uses them too.

Masks only add pixels: a hidden area cannot be un-hidden in an image already captured. Discard clears them. Reporter masks are saved with the draft and restored after reload. A restored screenshot, or a restored crop, whose geometry is unknown is dropped when a new hidden area overlaps it, rather than kept with the area visible.

## Contract with your capturer

Lightback masks after your capturer returns. For the masks to line up:

- Return an image of exactly the requested `area` (the whole document, or the viewport with `screenshotArea: 'viewport'`), scaled uniformly. This is the same contract crops rely on.
- Render elements where they are at the current scroll position. Fixed-position elements are measured in the viewport, offset by the scroll position. `domCapturer` does this for viewport captures.

The unmasked image exists briefly in memory, inside your capturer and during decoding. If your capturer sends the page to a service, exclude sensitive nodes there too. With `domCapturer`, combine its `filter` with your own:

```ts
screenshot: domCapturer((root, options) => import('modern-screenshot').then((m) => m.domToBlob(root, {
  ...options,
  filter: (node) => options.filter(node) && !(node instanceof Element && node.matches('[data-lightback-sensitive]')),
})))
```

`persistence.attachments: true` remains an explicit opt-in. Lightback stores only masked images. Content you have not marked is not masked.

## Sensitive versus ignored

`data-lightback-ignore` and `data-lightback-sensitive` do different jobs.

| | `data-lightback-ignore` | `data-lightback-sensitive` / `privacy.selectors` |
| --- | --- | --- |
| Purpose | Keep **Lightback's own UI** (and your feedback buttons) out of reports | Keep **your users' data** out of reports |
| Picker | Cannot be picked or hovered | Can be picked; the selection locates it without its content |
| Breadcrumbs | Not recorded | Recorded without text |
| Screenshots | Captured normally (the widget hides itself separately) | Masked |

## Limitations

- Masking covers marked elements and reporter areas. Text redaction rules (`redact.patterns`) do not apply to pixels, and form-control values, which the data side never records, are visible in screenshots unless their fields are marked.
- Open shadow roots and accessible same-origin frames are inspected and measured, including nested roots and assigned slots. Sensitive/ignore ancestry crosses those boundaries. Privacy selectors match separately in each root (ordinary CSS combinators do not cross roots). Inaccessible frames and frames with unsupported transforms are masked in full; closed roots cannot be discovered, so mark their hosts sensitive. A capturer must render nested contexts at the requested coordinates and current scroll positions.
- A capturer that renders fixed or sticky elements somewhere other than their current position produces misaligned masks. Whole-page DOM captures draw them where they would be with the page scrolled to the top. Viewport captures through `domCapturer` draw fixed elements where they are, and sticky elements unstuck: a stuck sensitive header is masked where it is on screen, over whatever the image shows there. Verify with your capturer and add margin via a wrapping sensitive element if needed.
- The base screenshot is captured at pick start. A sensitive element that appears later is masked only in later captures (retake the screenshot). With viewport captures, crops of selections outside the first capture come from a later capture.
- Older `@lightback/core` versions without privacy support: the widget still masks `[data-lightback-sensitive]` pixels, but the data side needs the new core.
