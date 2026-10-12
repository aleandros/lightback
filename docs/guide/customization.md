# Customization

Everything below is set on `mountWidget()` or, in React, on the `widget` prop of `LightbackProvider`. Sections marked **Planned** describe an API that is agreed but not yet implemented; see `docs/HANDOFF.md` Track C.

## Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `client` | `LightbackClient` | required | The client from `createLightback()`. |
| `screenshot` | `() => Promise<Blob \| null>` | none | Captures the page. Omit to disable screenshots entirely. |
| `autoScreenshot` | `boolean` | `true` when `screenshot` is set | Capture when pick mode starts and crop every selection. `false` returns to a manual Screenshot button in the panel. |
| `cropPadding` | `number` | `16` | CSS pixels of context around a selection in its crop. |
| `sendDelay` | `number` | `5000` | Milliseconds the "Sending…" card stays cancellable. `0` sends immediately. |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Corner for the pill, panel and pending card. |
| `accent` | CSS color | `#4f46e5` | Buttons, highlights, pins and crop outlines. Shorthand for the `--lb-accent` variable. |
| `triggerLabel` | `string` | `'✎ Write feedback'` | Label of the pill's open button. Superseded by `strings` once that ships. |
| `onSent` | `(payload) => void` | none | Called after a successful send. |
| `onError` | `(error) => void` | none | Called when the transport fails. The panel also reopens with the message. |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | **Planned.** Today the widget follows `prefers-color-scheme`. |
| `hideTrigger` | `boolean` | `false` | **Planned.** Hide the pill and drive the widget from your own UI through the handle. |
| `strings` | `Partial<WidgetStrings>` | English | **Planned.** Every visible label. See [Texts and i18n](./texts-and-i18n.md). |

## Colours and shape

The widget renders inside a Shadow DOM, so your stylesheet cannot reach its internals by accident. It exposes CSS custom properties on the host element instead. Set them on `lightback-widget` from any stylesheet:

```css
lightback-widget {
  --lb-accent: #0f766e;
  --lb-accent-contrast: #fff;
  --lb-bg: #ffffff;
  --lb-fg: #111827;
  --lb-muted: #6b7280;
  --lb-border: #e5e7eb;
  --lb-surface: #f9fafb;
  --lb-danger: #dc2626;
  --lb-radius: 12px;
  --lb-shadow: 0 10px 30px rgba(0, 0, 0, .18);
}
```

Fonts inherit from the page. The widget sets no `font-family` of its own, so it already matches your app.

Dark mode flips `--lb-bg`, `--lb-fg`, `--lb-muted`, `--lb-border` and `--lb-surface` under `prefers-color-scheme: dark`. Override them inside your own media query to tune it, or set `theme` once it ships to force one scheme.

**Planned: parts.** For changes the variables cannot express, the pill, panel, popover and pending card will carry `part` attributes (`pill`, `panel`, `popover`, `pending`) so `lightback-widget::part(pill) { … }` works. Variables stay the supported API; parts are the escape hatch and may change between minor versions.

## Position

`position` moves the whole widget to the bottom-left. There is no top placement. If you need the pill somewhere else, hide it and use your own trigger.

## Your own trigger

`mountWidget()` returns a handle. Call it from any button:

```ts
const widget = mountWidget({ client: lightback, screenshot });

document.querySelector('#report-bug')!.addEventListener('click', () => widget.startPicking());
document.querySelector('#feedback')!.addEventListener('click', () => widget.open());
```

In React, `useLightbackWidget()` returns the same handle. The pill cannot be hidden yet; `hideTrigger` (**Planned**) is the switch for apps that only want their own button.

## Screenshot capturer

Any function that resolves to a PNG or JPEG `Blob` of the page works. The widget hides itself and mutes the collectors while the function runs, so the capturer's own network calls never appear in the report.

```ts
// modern-screenshot (used by the playground)
screenshot: () => import('modern-screenshot').then((m) =>
  m.domToBlob(document.documentElement, { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))

// html2canvas
screenshot: () => import('html2canvas').then(async (m) => {
  const canvas = await m.default(document.body);
  return new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
})
```

Full-page size matters: crops are cut from this image using document coordinates, so a capture that stops at the viewport will produce blank crops for anything below the fold.

## Keeping the widget out of its own reports

Any element with `data-lightback-ignore` is invisible to the picker and the breadcrumb collector. The widget's host has it already. Use it on your own feedback button so a click on it is not recorded as a breadcrumb:

```html
<button id="report-bug" data-lightback-ignore>Report a bug</button>
```

## What the client controls

Capture, limits and redaction are client options, not widget options. See `createLightback()` in the README: `capture.networkBodies`, `limits.*`, `redact.headers`, `redact.urlParams`, `redact.patterns`, and `beforeSend`.
