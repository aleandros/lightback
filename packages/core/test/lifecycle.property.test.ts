import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { createLightback, type Draft, type LightbackClient } from '../src/client';
import { deferred, maxActions, propertyParameters, settle } from '../../../test/property';
import { cleanupStorage, draft, selection, setupStorage, storedRecord } from './property-fixtures';

type Channel = 'console' | 'errors' | 'network' | 'breadcrumbs';
const channels: Channel[] = ['console', 'errors', 'network', 'breadcrumbs'];
const operation = fc.record({
  kind: fc.constantFrom('edit', 'add', 'remove', 'event', 'flush', 'checkpoint', 'reload', 'expire', 'clear', 'start-send', 'finish-send', 'veto', 'destroy', 'recreate'),
  value: fc.nat(1000), channel: fc.constantFrom(...channels), fail: fc.boolean(),
});
type Action = typeof operation extends fc.Arbitrary<infer T> ? T : never;
type Events = Record<Channel, string[]>;
const emptyEvents = (): Events => ({ console: [], errors: [], network: [], breadcrumbs: [] });

// The oracle holds only user text, selection ids, event labels and lifecycle flags.
// It never calls cleanDraft, snapshot, persistence validation or RingBuffer.
async function run(actions: Action[], capacity: number) {
  setupStorage();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')));
  let current!: LightbackClient;
  const model = { draft: null as { text: string; ids: string[] } | null, events: emptyEvents(), alive: true };
  let gate: ReturnType<typeof deferred<void>> | undefined;
  let sendResult: Promise<unknown> | undefined;
  let veto = false;
  let submitted = { text: '', ids: [] as string[] };
  const create = () => createLightback({
    limits: Object.fromEntries(channels.map((key) => [key, capacity])), persistence: { maxAge: 1000 },
    beforeSend: (payload) => veto ? null : payload,
    send: () => gate?.promise ?? Promise.resolve(),
  });
  const materialize = (): Draft => ({ ...draft(model.draft?.text), selections: (model.draft?.ids ?? []).map(selection) });
  const emit = async (channel: Channel, label: string) => {
    if (channel === 'console') console.info(label);
    if (channel === 'errors') window.dispatchEvent(new ErrorEvent('error', { message: label }));
    if (channel === 'network') await window.fetch(`https://example.test/${label}`);
    if (channel === 'breadcrumbs') current.addBreadcrumb(label);
    model.events[channel].push(label);
    model.events[channel] = model.events[channel].slice(-capacity);
  };
  const check = () => {
    const actual = current.getDraft();
    expect(actual && { text: actual.text, ids: actual.selections.map((s) => s.id) }).toEqual(model.draft);
    const payload = current.buildPayload({});
    for (const channel of channels) {
      const labels = payload[channel].map((e) => 'url' in e ? e.url.split('/').pop() : e.message);
      expect(labels, channel).toEqual(model.events[channel]);
      expect(current.stats()[channel]).toBe(model.events[channel].length);
    }
  };
  const durable = async (flush = true) => {
    if (flush) await current.flushPersistence();
    const record = await storedRecord();
    const nonempty = model.draft && (model.draft.text || model.draft.ids.length) || channels.some((c) => model.events[c].length);
    if (!nonempty) expect(record).toBeUndefined();
    else {
      expect(record.state.draft && { text: record.state.draft.text, ids: record.state.draft.selections.map((s: { id: string }) => s.id) }).toEqual(model.draft);
      for (const channel of channels) expect(record.state[channel]).toHaveLength(model.events[channel].length);
    }
  };
  const stop = async () => { current.destroy(); await current.flushPersistence(); model.alive = false; };
  try {
    current = create(); await current.ready;
    for (const action of actions) {
      vi.setSystemTime(Date.now() + 1);
      const { kind, value, channel } = action;
      if (!model.alive && kind !== 'recreate') { check(); continue; }
      switch (kind) {
        case 'edit':
          model.draft = { text: `note-${value}`, ids: model.draft?.ids ?? [] };
          current.saveDraft(materialize()); break;
        case 'add':
          model.draft ??= { text: '', ids: [] };
          model.draft.ids = [...model.draft.ids, String(value)].slice(0, 50); current.saveDraft(materialize()); break;
        case 'remove':
          if (model.draft?.ids.length) { model.draft.ids.splice(value % model.draft.ids.length, 1); current.saveDraft(materialize()); }
          break;
        case 'event': await emit(channel, `event-${value}`); break;
        case 'flush': await durable(); break;
        case 'checkpoint': await vi.advanceTimersByTimeAsync(100); await durable(false); break;
        case 'clear':
          model.draft = null; model.events = emptyEvents(); await current.clearPersistence(); break;
        case 'start-send':
          if (!gate) {
            gate = deferred<void>();
            submitted = { text: model.draft?.text ?? '', ids: [...model.draft?.ids ?? []] };
            sendResult = current.send(materialize()).then((payload) => payload, (error: Error) => error.message);
            await settle();
          }
          break;
        case 'finish-send':
          if (gate) {
            if (action.fail) gate.reject(new Error('offline')); else gate.resolve();
            const result = await sendResult;
            if (action.fail) expect(result).toBe('offline');
            else {
              expect(result).toMatchObject({ note: { text: submitted.text }, selections: submitted.ids.map((id) => ({ id })) });
              model.draft = null; model.events = emptyEvents();
            }
            gate = undefined; sendResult = undefined;
          }
          break;
        case 'veto':
          if (!gate) { veto = true; expect(await current.send(materialize())).toBeNull(); veto = false; }
          break;
        case 'reload': case 'expire':
          if (!gate) {
            await durable(); await stop();
            // Empty editor state is intentionally not durable.
            if (model.draft && !model.draft.text && !model.draft.ids.length && !channels.some((c) => model.events[c].length)) model.draft = null;
            if (kind === 'expire') { vi.setSystemTime(Date.now() + 1001); model.draft = null; model.events = emptyEvents(); }
            current = create(); model.alive = true;
            await emit(channel, `startup-${value}`);
            await current.ready;
          }
          break;
        case 'destroy': if (!gate) await stop(); break;
        case 'recreate':
          if (!model.alive) {
            if (model.draft && !model.draft.text && !model.draft.ids.length && !channels.some((c) => model.events[c].length)) model.draft = null;
            current = create(); model.alive = true; await current.ready;
          }
          break;
      }
      check();
    }
  } finally {
    gate?.resolve(); await sendResult;
    if (current) { current.destroy(); await current.flushPersistence(); }
    cleanupStorage();
  }
}

it('models drafts, all collector buffers, recovery, send outcomes and teardown after every action', async () => {
  await fc.assert(fc.asyncProperty(fc.array(operation, { maxLength: maxActions, size: 'max' }), fc.integer({ min: 1, max: 8 }), run), propertyParameters());
}, 120_000);

it('specifies that successful in-flight sends clear current state, while failures retain intervening edits', async () => {
  for (const fail of [false, true]) {
    const action = (kind: Action['kind'], value = 1): Action => ({ kind, value, channel: 'breadcrumbs', fail });
    await run([action('edit'), action('event'), action('start-send'), action('edit', 2), action('event', 2), action('finish-send'), action('reload')], 3);
  }
});
