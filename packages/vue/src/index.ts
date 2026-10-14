import { inject, provide, onMounted, onBeforeUnmount, shallowRef, shallowReadonly, watch, toValue, getCurrentInstance, type InjectionKey, type MaybeRefOrGetter, type ShallowRef } from 'vue';
import type { LightbackClient } from '@lightback/core';
import { mountLazyWidget, type LazyWidgetHandle, type WidgetOptions } from '@lightback/widget/lazy';

export interface LightbackOptions {
  /** Read once during setup. Remount to change widget options. */
  widget?: boolean | Omit<WidgetOptions, 'client'>;
  /** Merged on mount and whenever reactive context changes. */
  context?: MaybeRefOrGetter<Record<string, unknown>>;
}
export interface LightbackIntegration {
  client: LightbackClient;
  widget: Readonly<ShallowRef<LazyWidgetHandle | null>>;
}
const key: InjectionKey<LightbackIntegration> = Symbol('lightback');

/** Call synchronously in setup. The caller owns the client and its lifetime. */
export function provideLightback(client: LightbackClient, options: LightbackOptions = {}): LightbackIntegration {
  if (!getCurrentInstance()) throw new Error('provideLightback must be called during setup');
  const handle = shallowRef<LazyWidgetHandle | null>(null);
  const widget = options.widget ?? true;
  const context = options.context;
  const widgetOptions = typeof widget === 'object' ? { ...widget } : {};
  let stop: (() => void) | undefined;
  const integration = { client, widget: shallowReadonly(handle) };
  provide(key, integration);
  onMounted(() => {
    if (context) stop = watch(() => toValue(context), (value) => client.setContext(value), { immediate: true, deep: true });
    if (widget) handle.value = mountLazyWidget({ ...widgetOptions, client });
  });
  onBeforeUnmount(() => {
    stop?.();
    handle.value?.destroy();
    handle.value = null;
  });
  return integration;
}
function integration(): LightbackIntegration {
  const value = inject(key, null);
  if (!value) throw new Error('Lightback composables require an ancestor calling provideLightback');
  return value;
}
export function useLightback(): LightbackClient { return integration().client; }
/** Readonly ref: null before mount and after teardown, or with widget: false. */
export function useLightbackWidget() { return integration().widget; }
export type { LightbackClient, LazyWidgetHandle, WidgetOptions };
