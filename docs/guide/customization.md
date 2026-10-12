# Customization

Everything below is set on `mountWidget()` or, in React, on the `widget` prop of `LightbackProvider`.

::: info Release availability
`strings`, `theme`, `hideTrigger` and styling parts are implemented in the repository for the next widget release. They are not included in npm `0.1.0`.
:::

## Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `client` | `LightbackClient` | required | The client from `createLightback()`. |
| `screenshot` | `() => Promise<Blob \| null>` | none | Captures the page. Omit to disable screenshots entirely. |
| `autoScreenshot` | `boolean` | `true` when `screenshot` is set | Capture when pick mode starts and crop every selection. The panel also offers manual capture/retake whenever a capturer is supplied. |
| `cropPadding` | `number` | `16` | CSS pixels of context around a selection in its crop. |
| `sendDelay` | `number` | `5000` | Milliseconds the "Sending…" card stays cancellable. `0` sends immediately. |
| `position` | `'bottom-right' \| 'bottom-left'` | `'bottom-right'` | Corner for the pill, panel and pending card. |
| `accent` | CSS color | `#4f46e5` | Buttons, highlights, pins and crop outlines. Shorthand for the `--lb-accent` variable. |
| `triggerLabel` | `string` | `'✎ Write feedback'` | Label of the pill's open button. Legacy alias; `strings.pillOpen` takes precedence. |
| `onSent` | `(payload) => void` | none | Called after a successful send. |
| `onError` | `(error) => void` | none | Called when the transport fails. The panel also reopens with the message. |
| `theme` | `'light' \| 'dark' \| 'auto'` | `'auto'` | Force a scheme or follow `prefers-color-scheme`. |
| `hideTrigger` | `boolean` | `false` | Hide the pill and drive the widget from your own UI through the handle. |
| `strings` | `Partial<WidgetStrings>` | English | Every visible label. See [Texts and i18n](./texts-and-i18n.md). |

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

The widget uses a system sans-serif font. Override `font-family` on `lightback-widget` to match your app. Text direction is inherited; physical placement follows `position`.

Dark mode flips `--lb-bg`, `--lb-fg`, `--lb-muted`, `--lb-border` and `--lb-surface` under `prefers-color-scheme: dark`. Override them inside your own media query to tune it, or set `theme` to force one scheme.

**Styling parts.** For changes the variables cannot express, the pill, panel, popover and pending card carry `part` attributes (`pill`, `panel`, `popover`, `pending`) so `lightback-widget::part(pill) { … }` works. Variables stay the supported API; parts are the escape hatch and may change between minor versions.

## Position

`position` moves the whole widget to the bottom-left. There is no top placement. If you need the pill somewhere else, hide it and use your own trigger.

## Your own trigger

`mountWidget()` returns a handle. Call it from any button:

```ts
const widget = mountWidget({ client: lightback, screenshot, hideTrigger: true });

document.querySelector('#report-bug')!.addEventListener('click', () => widget.startPicking());
document.querySelector('#feedback')!.addEventListener('click', () => widget.open());
```

In React, `useLightbackWidget()` returns the same handle. `hideTrigger: true` keeps the pill hidden after closing, cancelling, discarding, or sending. Your buttons can reopen the widget at any time.

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

## Theme and styling parts

```ts
mountWidget({ client: lightback, theme: 'dark', position: 'bottom-left' });
```

```css
lightback-widget::part(panel) { width: 420px; }
lightback-widget::part(pill) { border-radius: 8px; }
```

The other exposed parts are `popover` and `pending`. `theme: 'auto'` follows system changes without remounting. Options are read at mount time; remount to switch a forced theme or translation table.
