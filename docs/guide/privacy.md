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

React props come from the nearest named component above the element. Lightback walks that component's rendered fiber subtree; if any host element in it is sensitive, the props are omitted. Vue components are checked through their rendered roots; fragments contribute each root. Unknown roots, and React subtrees larger than 5000 fibers, count as sensitive. When nothing on the page is sensitive the check is skipped.

## Screenshot masking

With a `screenshot` capturer configured, the widget masks every capture before it becomes an attachment, a preview, a crop or a recovery record:

1. Sensitive rects are measured just before and just after the capturer runs. Content that appears, moves or becomes sensitive during an asynchronous capture is still covered.
2. The capturer's image is decoded and drawn to a canvas. Opaque boxes are painted over each sensitive rect and each hidden area, with a 2 CSS-pixel bleed against antialiasing.
3. The masked PNG replaces the original. The unmasked blob and bitmap are released; crops are cut from the masked canvas only.

If masking cannot run (no 2D canvas, or encoding fails), the image is dropped and `onError` is called. An unmasked image is never kept as a fallback.

`payload.masks` lists the boxes painted into the attached images, each with a document rect and a `reason` (`sensitive` or `reporter`). The prompt summarises them.

## Hidden areas (reporter masks)

When a capturer is configured, the pick bar shows **▨ Hide area** (`data-action="mask-mode"`). While it is on, clicking an element or dragging a rectangle hides that area instead of selecting it. Hidden areas show as hatched boxes while picking. They are painted into the current screenshot and existing crops at once (crops are re-cut), and into every later capture of the same draft.

Masks only add pixels: a hidden area cannot be un-hidden in an image already captured. Discard clears them. Reporter masks are saved with the draft and restored after reload. A restored screenshot, or a restored crop, whose geometry is unknown is dropped when a new hidden area overlaps it, rather than kept with the area visible.

## Contract with your capturer

Lightback masks after your capturer returns. For the masks to line up:

- Return an image of the **full document** (`scrollWidth` × `scrollHeight`), scaled uniformly. This is the same contract crops already rely on.
- Render elements where they are at the current scroll position. Fixed-position elements are measured in the viewport, offset by the scroll position.

The unmasked image exists briefly in memory, inside your capturer and during decoding. If your capturer sends the page to a service, exclude sensitive nodes there too. `modern-screenshot`, for example, accepts a `filter` option:

```ts
screenshot: () => import('modern-screenshot').then((m) => m.domToBlob(document.documentElement, {
  width: document.documentElement.scrollWidth,
  height: document.documentElement.scrollHeight,
  filter: (node) => !(node instanceof Element && node.matches('[data-lightback-sensitive]')),
}))
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
- Elements inside iframes or the host's own shadow roots are not inspected or measured.
- A capturer that renders fixed or sticky elements somewhere other than their current position produces misaligned masks. Verify with your capturer and add margin via a wrapping sensitive element if needed.
- The base screenshot is captured at pick start. A sensitive element that appears later is masked only in later captures (retake the screenshot).
- Older `@lightback/core` versions without privacy support: the widget still masks `[data-lightback-sensitive]` pixels, but the data side needs the new core.
