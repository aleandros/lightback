import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LightbackClient } from '@lightback/core';
import { mountLazyWidget, type LazyWidgetHandle, type WidgetOptions } from '@lightback/widget/lazy';
type WidgetHandle = LazyWidgetHandle;

interface Ctx {
  client: LightbackClient;
  widget: WidgetHandle | null;
}

const LightbackContext = createContext<Ctx | null>(null);

export interface LightbackProviderProps {
  /** Create it once outside React with `createLightback()` so collectors start at page load. */
  client: LightbackClient;
  /** Mount a lightweight trigger; load the widget UI on first interaction. `false` to bring your own UI. */
  widget?: boolean | Omit<WidgetOptions, 'client'>;
  /** Context merged into the client whenever it changes (user, session, flags...). */
  context?: Record<string, unknown>;
  children?: ReactNode;
}

export function LightbackProvider({ client, widget = true, context, children }: LightbackProviderProps) {
  const [handle, setHandle] = useState<WidgetHandle | null>(null);

  useEffect(() => {
    if (!widget) return;
    const h = mountLazyWidget({ client, ...(typeof widget === 'object' ? widget : {}) });
    setHandle(h);
    return () => {
      h.destroy();
      setHandle(null);
    };
    // Widget options are read once; recreate the provider to change them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, Boolean(widget)]);

  useEffect(() => {
    if (context) client.setContext(context);
  }, [client, context]);

  return <LightbackContext.Provider value={{ client, widget: handle }}>{children}</LightbackContext.Provider>;
}

export function useLightback(): LightbackClient {
  const ctx = useContext(LightbackContext);
  if (!ctx) throw new Error('useLightback must be used inside <LightbackProvider>');
  return ctx.client;
}

/** The lazy widget handle, or null before the effect mounts / when `widget={false}`. */
export function useLightbackWidget(): WidgetHandle | null {
  const ctx = useContext(LightbackContext);
  if (!ctx) throw new Error('useLightbackWidget must be used inside <LightbackProvider>');
  return ctx.widget;
}

export type { LightbackClient, WidgetHandle, WidgetOptions };
