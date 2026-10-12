import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { createLightback, type ElementSelection } from '@lightback/core';
import { mountWidget } from '../src/ui';
import { maxActions, propertyParameters, settle } from '../../../test/property';

const actionArb = fc.record({
  kind: fc.constantFrom('edit', 'pick', 'select', 'remove', 'queue', 'cancel', 'review', 'tick', 'send', 'discard', 'destroy', 'recreate'),
  value: fc.nat(100), outcome: fc.constantFrom('success', 'fail', 'veto'),
});
type Action = typeof actionArb extends fc.Arbitrary<infer T> ? T : never;
const makeSelection = (id: string): ElementSelection => ({
  id, kind: 'element', selector: '#target', tag: 'button', text: 'Target', attrs: {}, classes: [],
  components: [], chain: [], framework: null, rect: { x: 10, y: 10, width: 30, height: 20 }, docRect: { x: 10, y: 10, width: 30, height: 20 },
});

async function run(actions: Action[]) {
  vi.useFakeTimers();
  let outcome: Action['outcome'] = 'success';
  const deliver = vi.fn(async () => { if (outcome === 'fail') throw new Error('offline'); });
  const client = createLightback({ persistence: false, capture: { console: false, errors: false, network: false, breadcrumbs: false },
    beforeSend: (payload) => outcome === 'veto' ? null : payload, send: deliver });
  let widget = mountWidget({ client, autoScreenshot: false, sendDelay: 100 });
  const model = { text: '', ids: [] as string[], alive: true, picking: false, pending: false, sends: 0 };
  let nextId = 0;
  vi.spyOn(client, 'describeElement').mockImplementation(() => makeSelection(String(nextId)));
  const target = document.createElement('button'); document.body.appendChild(target);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  const q = (ref: string) => widget.element.shadowRoot!.querySelector<HTMLElement>(`[data-ref=${ref}]`)!;
  const click = (action: string) => widget.element.shadowRoot!.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!.click();
  const finish = () => {
    model.pending = false;
    if (outcome !== 'veto') model.sends++;
    if (outcome === 'success') { model.text = ''; model.ids = []; }
  };
  const check = () => {
    expect(deliver).toHaveBeenCalledTimes(model.sends);
    expect(widget.element.isConnected).toBe(model.alive);
    if (!model.alive) return;
    expect((q('text') as HTMLTextAreaElement).value).toBe(model.text);
    expect(q('pending').hidden).toBe(!model.pending);
    expect(widget.element.shadowRoot!.querySelector<HTMLElement>('.lb-pickbar')!.hidden).toBe(!model.picking);
    expect(client.getDraft()?.text ?? '').toBe(model.text);
    expect(client.getDraft()?.selections.map((s) => s.id) ?? []).toEqual(model.ids);
    const names = client.getDraft()?.attachments.map((a) => a.name) ?? [];
    for (const selection of client.getDraft()?.selections ?? []) if (selection.crop) expect(names).toContain(selection.crop);
  };
  try {
    await settle();
    for (const action of actions) {
      if (!model.alive && action.kind !== 'recreate') { check(); continue; }
      outcome = action.outcome;
      switch (action.kind) {
        case 'edit':
          if (!model.pending) {
            widget.open(); model.picking = false; model.text = `note-${action.value}`;
            (q('text') as HTMLTextAreaElement).value = model.text; q('text').dispatchEvent(new Event('input'));
          }
          break;
        case 'pick': if (!model.pending) { widget.startPicking(); model.picking = true; } break;
        case 'select':
          if (model.picking) { nextId++; target.click(); model.ids.push(String(nextId)); }
          break;
        case 'remove':
          if (!model.pending && model.ids.length) {
            const index = action.value % model.ids.length;
            widget.element.shadowRoot!.querySelector<HTMLButtonElement>(`[data-ref=selections] [data-id="${model.ids[index]}"] [data-action=sel-remove]`)!.click();
            model.ids.splice(index, 1);
          }
          break;
        case 'queue':
          if (!model.pending && (model.text || model.ids.length)) {
            // Enter uses the same public popover event path even for a text-only draft.
            q('popText').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            model.pending = true; model.picking = false;
          }
          break;
        case 'cancel': case 'review':
          if (model.pending) { click(action.kind === 'cancel' ? 'pending-cancel' : 'pending-edit'); model.pending = false; }
          break;
        case 'tick':
          if (model.pending) finish();
          await vi.advanceTimersByTimeAsync(100); break;
        case 'send':
          if (!model.pending && (model.text || model.ids.length)) { widget.open(); model.picking = false; click('send'); finish(); }
          break;
        case 'discard':
          widget.open(); click('discard'); model.text = ''; model.ids = []; model.pending = false; model.picking = false; break;
        case 'destroy':
          widget.destroy(); model.alive = false; model.pending = false; model.picking = false; break;
        case 'recreate':
          if (!model.alive) { widget = mountWidget({ client, autoScreenshot: false, sendDelay: 100 }); model.alive = true; }
          break;
      }
      await settle(); check();
    }
    widget.destroy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(deliver).toHaveBeenCalledTimes(model.sends);
  } finally {
    widget.destroy(); client.destroy(); target.remove();
    delete (document as Partial<Document>).elementFromPoint;
    vi.restoreAllMocks(); vi.useRealTimers();
  }
}

it('models editable recovery, picking, selection removal, pending cancel/edit and send outcomes', async () => {
  await fc.assert(fc.asyncProperty(fc.array(actionArb, { maxLength: maxActions, size: 'max' }), run), propertyParameters());
}, 120_000);

it('never resumes a pending timer or picking after remount', async () => {
  const action = (kind: Action['kind']): Action => ({ kind, value: 1, outcome: 'success' });
  await run(['edit', 'queue', 'destroy', 'recreate', 'tick', 'pick', 'select', 'destroy', 'recreate', 'tick'].map((kind) => action(kind as Action['kind'])));
});
