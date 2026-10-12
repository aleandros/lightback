import { createLazyWidget, type LazyWidgetHandle } from './lazy-controller';
import type { WidgetOptions } from './types';
import { importWidget } from './module-loader';
export type { LazyWidgetHandle } from './lazy-controller';
export type { WidgetOptions, WidgetHandle } from './types';
export { defaultStrings, type WidgetStrings } from './strings';

// Replaced by the package build. Source imports use the dev server's TS transform.
declare const __LIGHTBACK_CJS__: boolean;
declare const __LIGHTBACK_UI_FILE__: string;

/** Mount only a trigger; import the editor and picker on the first interaction. */
export function mountLazyWidget(options: WidgetOptions): LazyWidgetHandle {
  return createLazyWidget(options, () => {
    // CommonJS bundlers own chunk loading; require does not cache failed evaluations.
    if (typeof __LIGHTBACK_CJS__ !== 'undefined' && __LIGHTBACK_CJS__) return import('./ui');
    // A self-contained ESM asset lets native imports retry without a cached failed dependency.
    const url = new URL(typeof __LIGHTBACK_UI_FILE__ === 'undefined' ? './ui.ts' : __LIGHTBACK_UI_FILE__, import.meta.url);
    return importWidget(url);
  });
}
