import { createLazyWidget, type LazyWidgetHandle } from './lazy-controller';
import type { WidgetOptions } from './types';
import { importWidget } from './module-loader';
export { createLightback } from '@lightback/core';
export { defaultStrings } from './strings';

// Capture while the classic script executes, before any visitor interaction.
const scriptUrl = typeof document === 'undefined' ? undefined : (document.currentScript as HTMLScriptElement | null)?.src;

export function mountLazyWidget(options: WidgetOptions & { widgetUrl?: string }): LazyWidgetHandle {
  const url = options.widgetUrl ?? (scriptUrl ? new URL('./lightback-ui.js', scriptUrl).href : undefined);
  return createLazyWidget(options, () => {
    if (!url) return Promise.reject(new Error('Lightback: provide widgetUrl when the lazy script has no src'));
    return importWidget(new URL(url, document.baseURI));
  });
}
