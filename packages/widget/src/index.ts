import { mountWidget as mount } from './ui';
import type { WidgetOptions, WidgetHandle } from './types';
export type { WidgetOptions, WidgetHandle } from './types';
export { defaultStrings, type WidgetStrings } from './strings';

/** Mount the complete UI immediately. For deferred loading use @lightback/widget/lazy. */
export function mountWidget(options: WidgetOptions): WidgetHandle {
  return mount(options);
}
