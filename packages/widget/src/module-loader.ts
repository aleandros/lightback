import type { WidgetHandle, WidgetOptions } from './types';

type WidgetModule = { mountWidget(options: WidgetOptions, element: HTMLElement): WidgetHandle };
const modules = new Map<string, { attempts: number; pending?: Promise<WidgetModule> }>();

/** Share successful downloads across mounts, but never cache a rejected import. */
export function importWidget(url: URL): Promise<WidgetModule> {
  const key = url.href;
  let entry = modules.get(key);
  if (!entry) {
    entry = { attempts: 0 };
    modules.set(key, entry);
  }
  if (entry.pending) return entry.pending;
  const state = entry;
  const target = new URL(key);
  if (state.attempts++ > 0) target.searchParams.set('lightback-retry', String(state.attempts));
  state.pending = import(/* @vite-ignore */ target.href).catch((error: unknown) => {
    state.pending = undefined;
    throw error;
  });
  return state.pending;
}
