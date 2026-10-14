import { getContext, setContext, onMount } from 'svelte';
import { writable, readonly, type Readable } from 'svelte/store';
import type { LightbackClient } from '@lightback/core';
import { mountLazyWidget, type LazyWidgetHandle, type WidgetOptions } from '@lightback/widget/lazy';

export interface LightbackOptions {
  /** Read once during component initialization. Remount to change options. */
  widget?: boolean | Omit<WidgetOptions, 'client'>;
  /** A plain snapshot or a store whose updates are merged into the client. */
  context?: Record<string, unknown> | Readable<Record<string, unknown>>;
}
export interface LightbackIntegration {
  client: LightbackClient;
  widget: Readable<LazyWidgetHandle | null>;
}
const key = Symbol('lightback');
/** Call during component initialization. The caller owns the client and its lifetime. */
export function provideLightback(client: LightbackClient, options: LightbackOptions = {}): LightbackIntegration {
  const handle = writable<LazyWidgetHandle | null>(null);
  const widget = options.widget ?? true;
  const widgetOptions = typeof widget === 'object' ? { ...widget } : {};
  const context = options.context;
  const integration = { client, widget: readonly(handle) };
  setContext(key, integration);
  onMount(() => {
    let unsubscribe: (() => void) | undefined;
    if (context) {
      if (typeof context.subscribe === 'function') unsubscribe = (context as Readable<Record<string, unknown>>).subscribe((value) => client.setContext(value));
      else client.setContext(context as Record<string, unknown>);
    }
    let mounted: LazyWidgetHandle | undefined;
    try {
      if (widget) { mounted = mountLazyWidget({ ...widgetOptions, client }); handle.set(mounted); }
    } catch (error) { unsubscribe?.(); throw error; }
    return () => { unsubscribe?.(); mounted?.destroy(); handle.set(null); };
  });
  return integration;
}
function integration(): LightbackIntegration {
  const value = getContext<LightbackIntegration | undefined>(key);
  if (!value) throw new Error('Lightback helpers require an ancestor calling provideLightback');
  return value;
}
export function useLightback(): LightbackClient { return integration().client; }
/** Readable store: null before mount and after teardown, or with widget: false. */
export function useLightbackWidget(): Readable<LazyWidgetHandle | null> { return integration().widget; }
export type { LightbackClient, LazyWidgetHandle, WidgetOptions };
