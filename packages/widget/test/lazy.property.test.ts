import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { createLightback } from '@lightback/core';
import { createLazyWidget } from '../src/lazy-controller';
import { mountWidget } from '../src/ui';
import { deferred, maxActions, propertyParameters, settle } from '../../../test/property';

it('models lazy activation, coalesced intents, load failure/retry and teardown', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom('open', 'pick', 'close', 'resolve', 'reject', 'destroy'), { maxLength: maxActions, size: 'max' }), async (actions) => {
    const client = createLightback({ persistence: false, capture: { console: false, errors: false, network: false, breadcrumbs: false } });
    let load = deferred<{ mountWidget: typeof mountWidget }>();
    const loader = vi.fn(() => load.promise);
    const onError = vi.fn();
    const handle = createLazyWidget({ client, onError, autoScreenshot: false }, loader);
    const host = handle.element;
    const model = { alive: true, mounted: false, loading: false, intent: '' as string, panel: false, picking: false, calls: 0, errors: 0 };
    try {
      await settle();
      for (const action of actions) {
        if (action === 'open' || action === 'pick') {
          void (action === 'open' ? handle.open() : handle.startPicking()).catch(() => {});
          if (model.alive) {
            if (model.mounted) { model.panel = action === 'open'; model.picking = action === 'pick'; }
            else { model.intent = action; if (!model.loading) { model.loading = true; model.calls++; } }
          }
        }
        if (action === 'close') { handle.close(); model.intent = ''; model.panel = false; model.picking = false; }
        if ((action === 'resolve' || action === 'reject') && model.loading) {
          if (action === 'resolve') {
            load.resolve({ mountWidget });
            if (model.alive && model.intent) { model.mounted = true; model.panel = model.intent === 'open'; model.picking = model.intent === 'pick'; }
          } else { load.reject(new Error('offline')); if (model.alive) model.errors++; }
          model.loading = false;
          await settle(); load = deferred();
        }
        if (action === 'destroy') { handle.destroy(); model.alive = false; }
        await settle();
        expect(loader).toHaveBeenCalledTimes(model.calls);
        expect(onError).toHaveBeenCalledTimes(model.errors);
        expect(handle.element).toBe(host);
        expect(host.isConnected).toBe(model.alive);
        if (model.alive) {
          const panel = host.shadowRoot!.querySelector<HTMLElement>('[data-ref=panel]');
          expect(Boolean(panel)).toBe(model.mounted);
          if (panel) {
            expect(panel.hidden).toBe(!model.panel);
            expect(host.shadowRoot!.querySelector<HTMLElement>('.lb-pickbar')!.hidden).toBe(!model.picking);
          }
        }
      }
    } finally { handle.destroy(); load.resolve({ mountWidget }); await settle(); client.destroy(); }
  }), propertyParameters());
}, 120_000);
