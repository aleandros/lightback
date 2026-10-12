# Texts and i18n

> **Status: Planned.** Today only `triggerLabel` is configurable; every other label is English and hard-coded in `packages/widget/src/index.ts`. This page is the agreed design. Implementing it is Track C1 in `docs/HANDOFF.md`.

## Design

One option, `strings`, holds every user-visible string. You pass the ones you want to change; the rest fall back to the exported English defaults. Locale detection is the host app's job: you already know the user's language, so pass the right table.

```ts
import { mountWidget, defaultStrings, type WidgetStrings } from '@lightback/widget';

const es: Partial<WidgetStrings> = {
  pillPick: '⌖ Señalar algo',
  pillOpen: '✎ Escribir comentario',
  pillReview: '✎ Revisar y enviar',
  pickHint: 'Haz clic en un elemento o arrastra un área',
  countSelected: (n) => `${n} seleccionado${n === 1 ? '' : 's'}`,
  cancel: 'Cancelar',
  done: (n) => (n ? `Listo (${n})` : 'Listo'),
  // …
};

mountWidget({ client, strings: navigator.language.startsWith('es') ? es : undefined });
```

Strings that embed a number are functions so plural rules stay in your hands. Everything else is a plain string.

## Proposed keys

| Key | Default (English) | Where |
| --- | --- | --- |
| `pillPick` | `⌖ Point at something` | Pill |
| `pillPickCount` | `(n) => \`⌖ Point at something (${n})\`` | Pill with a draft |
| `pillOpen` | `✎ Write feedback` | Pill |
| `pillReview` | `✎ Review & send` | Pill with a draft |
| `panelTitle` | `Send feedback` | Panel header |
| `noteLabel` | `What happened?` | Panel |
| `notePlaceholder` | `Describe the problem or idea. Point at elements to add context.` | Panel |
| `pick` | `⌖ Point at something` | Panel button |
| `screenshot` | `📷 Screenshot` | Panel button (manual mode) |
| `reviewSummary` | `Review what will be sent` | Panel details |
| `tabPrompt`, `tabJson` | `Prompt`, `JSON` | Panel review tabs |
| `discard` | `Discard` | Panel footer |
| `send` | `Send` | Panel footer and popover |
| `pickHint` | `Click an element or drag an area` | Pickbar |
| `countSelected` | `(n) => \`${n} selected\`` | Pickbar |
| `cancel` | `Cancel` | Pickbar and pending card |
| `done` | `(n) => n ? \`Done (${n})\` : 'Done'` | Pickbar |
| `popoverPlaceholder` | `What about this? (optional)` | Comment box |
| `remove` | `Remove` | Comment box |
| `addMore` | `Add more` | Comment box |
| `popoverHint` | `Enter to send · Shift+Enter for a new line` | Comment box |
| `areaIn` | `(container) => \`Area in ${container}\`` | Comment box title for regions |
| `elementCount` | `(n) => \`${n} elements\`` | Comment box title for regions |
| `sending` | `Sending feedback…` | Pending card |
| `edit` | `Edit` | Pending card |
| `summarySelections` | `(n) => \`${n} selection${n === 1 ? '' : 's'}\`` | Pending card summary |
| `sent` | `Feedback sent. Thank you!` | Toast |
| `sendFailed` | `(message) => \`Could not send: ${message}\`` | Toast and panel status |
| `close`, `removeScreenshot`, `editComment`, `removeSelection` | aria labels | Icon buttons |

Keys will be finalised when the option ships; treat this list as the inventory of what must become configurable, taken from the current template.

## What is not in scope

- **Component names and selectors** in the comment box title (`InvoiceRow ‹ InvoiceTable "Retry"`) come from your code and are not translated.
- **The payload** is never localised. Field names are fixed and the prompt rendered by `toPromptContext` is English, because it is addressed to a model, not to the user. If your triage model should answer in another language, say so in your instruction, not in the payload.
- **Dates** in the payload are ISO 8601. The widget shows none.

## Right-to-left

The widget inherits `direction` from the host document. The pill, panel and pending card are anchored by `position` (`bottom-right` or `bottom-left`), which does not flip automatically; set `position: 'bottom-left'` for RTL layouts if you want the mirrored placement. This should become automatic once a `dir`-aware default lands; it is not yet scheduled.

## Migration from `triggerLabel`

`triggerLabel` stays supported and maps to `strings.pillOpen`. New code should use `strings`.
