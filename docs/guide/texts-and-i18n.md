# Texts and i18n

::: info Release availability
`strings` and `defaultStrings` are implemented in the repository for the next widget release. npm `0.1.0` supports only `triggerLabel`.
:::

## Design

One option, `strings`, holds every user-visible string. You pass the ones you want to change; the rest fall back to the exported English defaults. Locale detection is the host app's job: you already know the user's language, so pass the right table.

```ts
import { mountWidget, type WidgetStrings } from '@lightback/widget';

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

Messages that embed a number, container name or error detail are functions, so plural rules and word order stay in your hands. Other labels are plain strings.

## All keys

The [generated string reference](./strings-reference.md) lists every label, placeholder, title, accessibility label, status message, and dynamic count with its English default. It is rebuilt from `defaultStrings` with the docs. Overrides are treated as text, never HTML.

Use `sendFailed(message)` and `screenshotFailed(message)` to translate the surrounding message; error details supplied by your transport or screenshot library remain in their original language. The raw Prompt and JSON previews retain their technical format.

## What is not in scope

- **Component names and selectors** in the comment box title (`InvoiceRow ‹ InvoiceTable "Retry"`) come from your code and are not translated.
- **The payload** is never localised. Field names are fixed and the prompt rendered by `toPromptContext` is English, because it is addressed to a model, not to the user. If your triage model should answer in another language, say so in your instruction, not in the payload.
- **Dates** use ISO 8601 for `createdAt`; collector timestamps use epoch milliseconds. The widget shows neither.

## Right-to-left

The widget inherits `direction` from the host document. The pill, panel and pending card are anchored by `position` (`bottom-right` or `bottom-left`), which does not flip automatically; set `position: 'bottom-left'` for RTL layouts if you want the mirrored placement. This should become automatic once a `dir`-aware default lands; it is not yet scheduled.

## Migration from `triggerLabel`

`triggerLabel` stays supported as an alias for `strings.pillOpen`. When both are supplied, `strings.pillOpen` wins. New code should use `strings`. Remount the widget to apply a changed locale.
