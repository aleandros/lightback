'use client';

import { useEffect, useState } from 'react';
import { createLightback, toPromptContext } from '@lightback/core';
import { mountWidget } from '@lightback/widget';

export default function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const client = createLightback({ persistence: false, send: async (payload) => {
      (window as any).report = { payload, prompt: toPromptContext(payload) };
    } });
    const widget = mountWidget({ client, sendDelay: 0 });
    (window as any).fixture = { client, widget, hydrated: true };
    return () => { widget.destroy(); client.destroy(); };
  }, []);
  const probe = () => { try { throw new Error('lightback-map-probe'); } catch (error) { (window as any).probeStack = (error as Error).stack; } };
  return (
    <section data-testid="client">
      <button data-action="increment" onClick={() => setCount(count + 1)}>{count}</button>
      <button data-action="probe" onClick={probe}>Probe source maps</button>
      <span data-testid="loader-marker">__LIGHTBACK_LOADER_MARKER__</span>
    </section>
  );
}
