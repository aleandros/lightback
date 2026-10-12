import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { createLightback, type LightbackClient } from '../src/client';
import { RingBuffer } from '../src/ring';
import { deferred, maxActions, propertyParameters, settle } from '../../../test/property';
import { cleanupStorage, draft, noCapture, selection, setupStorage, storedRecord } from './property-fixtures';

it('keeps ring order and capacity through pushes, clears, touches and snapshot mutation', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 30 }), fc.array(fc.option(fc.integer()), { maxLength: maxActions * 3 }), (capacity, actions) => {
    const ring = new RingBuffer<number>(capacity);
    let expected: number[] = [];
    for (const action of actions) {
      if (action === null) { ring.clear(); expected = []; }
      else { ring.push(action); expected.push(action); while (expected.length > capacity) expected.shift(); }
      ring.touch();
      expect(ring.toArray()).toEqual(expected);
      expect(ring.size).toBe(expected.length);
      ring.toArray().push(123); // Mutating a snapshot cannot change the ring.
      expect(ring.toArray()).toEqual(expected);
    }
  }), propertyParameters());
});

it('redacts secrets before truncation and excludes form/HTML metadata at the durable boundary', async () => {
  await fc.assert(fc.asyncProperty(fc.string({ minLength: 1, maxLength: 80 }), fc.integer({ min: 1, max: 120 }), async (suffix, limit) => {
    setupStorage();
    const secret = `PRIVATE_${Array.from(suffix).map((s) => s.codePointAt(0)!.toString(16)).join('_')}_END`;
    const client = createLightback({ capture: noCapture, limits: { string: limit }, redact: { patterns: [/PRIVATE_[\da-f_]+_END/g] } });
    try {
      await client.ready;
      client.saveDraft({ ...draft(secret), selections: [{ ...selection('one'), html: secret, props: { value: secret, defaultValue: secret }, note: secret }] });
      client.addBreadcrumb(secret, { password: secret, body: JSON.stringify({ token: secret }), url: `https://test/?token=${secret}` });
      await client.flushPersistence();
      const record = await storedRecord();
      expect(record.state.draft.text).toBe('[redacted]'.slice(0, limit));
      const json = JSON.stringify(record);
      expect(json).not.toContain('PRIVATE');
      expect(json).not.toContain('"html"');
      expect(json).not.toContain('"value"');
      expect(json).not.toContain('"defaultValue"');
    } finally { client.destroy(); await client.flushPersistence(); cleanupStorage(); }
  }), propertyParameters());
}, 120_000);

it('validates generated incompatible and malformed records while retaining valid notes with bad selections', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('version', 'timestamp', 'channel', 'draft', 'selection', 'expired'), fc.jsonValue(), async (kind, garbage) => {
    setupStorage();
    const clients: LightbackClient[] = [];
    try {
      const first = createLightback({ capture: noCapture }); clients.push(first); await first.ready;
      first.saveDraft(draft('keep')); await first.flushPersistence(); first.destroy(); await first.flushPersistence();
      await storedRecord((record) => {
        if (kind === 'version') record.version = 2;
        if (kind === 'timestamp') record.savedAt = JSON.stringify(garbage);
        if (kind === 'channel') record.state.console = { invalid: garbage };
        if (kind === 'draft') record.state.draft.selections = { invalid: garbage };
        if (kind === 'selection') record.state.draft.selections = [{ invalid: garbage }];
        if (kind === 'expired') record.expiresAt = Date.now();
        return record;
      });
      const second = createLightback({ capture: noCapture }); clients.push(second); await second.ready;
      expect(second.getDraft()?.text ?? null).toBe(kind === 'selection' ? 'keep' : null);
      expect(second.getDraft()?.selections ?? []).toEqual([]);
      if (kind !== 'selection') expect(await storedRecord()).toBeUndefined();
    } finally { for (const client of clients) { client.destroy(); await client.flushPersistence(); } cleanupStorage(); }
  }), propertyParameters());
}, 120_000);

it('keeps opted-in attachment bytes within budget with consistent recovered references under stricter policy', async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.integer({ min: 1, max: 6000 }), fc.uint8Array({ maxLength: 3000 }), async (optIn, restoreOptIn, maxBytes, bytes) => {
    setupStorage();
    // fake-indexeddb structured clones in Node's realm, as does NodeBlob.arrayBuffer.
    vi.stubGlobal('ArrayBuffer', (await new Blob([]).arrayBuffer()).constructor);
    const clients: LightbackClient[] = [];
    try {
      const first = createLightback({ capture: noCapture, persistence: { attachments: optIn, maxBytes } }); clients.push(first); await first.ready;
      const blob = new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
      first.saveDraft({ ...draft('image'), selections: [{ ...selection('one'), crop: 'crop.png' }], attachments: [{ name: 'crop.png', type: blob.type, size: blob.size, blob }] });
      await first.flushPersistence(); first.destroy(); await first.flushPersistence();
      const record = await storedRecord();
      if (record) {
        const attachments = record.state.draft.attachments;
        expect(attachments.length).toBeLessThanOrEqual(optIn ? 1 : 0);
        const metadataBytes = new Blob([JSON.stringify(record)]).size;
        const attachmentBytes = attachments.reduce((n: number, a: { data: ArrayBuffer }) => n + a.data.byteLength, 0);
        expect(metadataBytes + attachmentBytes).toBeLessThanOrEqual(maxBytes);
        if (record.state.draft.selections[0].crop) expect(attachments.map((a: { name: string }) => a.name)).toContain('crop.png');
      }
      const second = createLightback({ capture: noCapture, persistence: { attachments: restoreOptIn } }); clients.push(second); await second.ready;
      const recovered = second.getDraft();
      if (recovered) {
        for (const item of recovered.selections) if (item.crop) expect(recovered.attachments.map((a) => a.name)).toContain(item.crop);
        if (!restoreOptIn) expect(recovered.attachments).toEqual([]);
        for (const attachment of recovered.attachments) expect(new Uint8Array(await attachment.blob.arrayBuffer())).toEqual(bytes);
      }
    } finally { for (const client of clients) { client.destroy(); await client.flushPersistence(); } cleanupStorage(); }
  }), propertyParameters());
}, 120_000);

it('falls back to memory and invalidates stale sessions after denied or quota-failed storage', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('denied', 'quota', 'disabled'), fc.array(fc.nat(1000), { minLength: 1, maxLength: 8 }), async (failure, edits) => {
    setupStorage();
    const clients: LightbackClient[] = [];
    try {
      const first = createLightback({ capture: noCapture }); clients.push(first); await first.ready;
      first.saveDraft(draft('stale')); await first.flushPersistence(); first.destroy(); await first.flushPersistence();
      const open = vi.spyOn(indexedDB, 'open');
      const denied = failure === 'denied' ? vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); }) : undefined;
      const current = createLightback({ capture: noCapture, persistence: failure === 'disabled' ? false : undefined, send: async () => {} }); clients.push(current); await current.ready;
      if (failure === 'disabled') expect(open).not.toHaveBeenCalled();
      const quota = failure === 'quota' ? vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); }) : undefined;
      for (const edit of edits) { current.saveDraft(draft(`edit-${edit}`)); await current.flushPersistence(); expect(current.getDraft()?.text).toBe(`edit-${edit}`); }
      if (failure === 'quota') expect(sessionStorage.getItem('lightback:session:default')).toBeNull();
      await expect(current.send(current.getDraft()!)).resolves.toBeTruthy();
      expect(current.getDraft()).toBeNull();
      current.destroy(); await current.flushPersistence(); quota?.mockRestore(); denied?.mockRestore();
      if (failure === 'quota') {
        const next = createLightback({ capture: noCapture }); clients.push(next); await next.ready; expect(next.getDraft()).toBeNull();
      }
    } finally { for (const client of clients) { client.destroy(); await client.flushPersistence(); } cleanupStorage(); }
  }), propertyParameters());
}, 120_000);

/** Delay only the open notification; fake-indexeddb still owns transactions and cloning. */
function holdOpen() {
  const original = indexedDB.open.bind(indexedDB);
  const opened = deferred<() => void>();
  vi.spyOn(indexedDB, 'open').mockImplementationOnce((name, version) => {
    const request = original(name, version);
    let success: ((event: Event) => void) | null = null;
    Object.defineProperty(request, 'onsuccess', { get: () => success, set: (fn) => { success = fn; } });
    request.addEventListener('success', () => opened.resolve(() => success?.call(request, new Event('success'))));
    return request;
  });
  return opened.promise;
}

async function readRace(clear: boolean, beforeOpen: boolean, startup: number[]) {
  setupStorage();
  const clients: LightbackClient[] = [];
  try {
    const first = createLightback({ capture: { ...noCapture, breadcrumbs: true } }); clients.push(first); await first.ready;
    first.saveDraft(draft('stale')); first.addBreadcrumb('stale'); await first.flushPersistence(); first.destroy(); await first.flushPersistence();
    const opened = holdOpen();
    const next = createLightback({ capture: { ...noCapture, breadcrumbs: true } }); clients.push(next);
    const release = await opened;
    if (!beforeOpen) { release(); await settle(); }
    let cleared: Promise<void> | undefined;
    if (clear) cleared = next.clearPersistence(); else next.destroy();
    for (const n of startup) next.addBreadcrumb(`startup-${n}`);
    if (beforeOpen) release();
    await next.ready; await cleared;
    expect(next.getDraft()).toBeNull();
    expect(next.buildPayload({}).breadcrumbs.map((b) => b.message)).toEqual(startup.map((n) => `startup-${n}`));
    await next.flushPersistence();
  } finally { for (const client of clients) { client.destroy(); await client.flushPersistence(); } cleanupStorage(); }
}

it('clear/destroy beats recovery before open or cursor completion, preserving only new startup events', async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.array(fc.nat(100), { maxLength: 8 }), readRace), propertyParameters());
}, 120_000);

it('regression: clear before storage opens cannot restore old collector entries', async () => {
  await readRace(true, true, []);
});

it('clear beats queued checkpoints and blob encodes, even with edits and a reload during the write', async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.nat(100), { maxLength: 8 }), fc.boolean(), async (edits, destroy) => {
    setupStorage();
    const clients: LightbackClient[] = [];
    const encoded = deferred<ArrayBuffer>();
    try {
      const first = createLightback({ capture: noCapture, persistence: { attachments: true } }); clients.push(first); await first.ready;
      first.saveDraft(draft('committed')); await first.flushPersistence();
      const blob = new Blob(['image']);
      vi.spyOn(blob, 'arrayBuffer').mockReturnValue(encoded.promise);
      first.saveDraft({ ...draft('in-flight'), attachments: [{ name: 'image.png', type: blob.type, size: blob.size, blob }] });
      const write = first.flushPersistence(); await settle();
      // A reload sees the last complete transaction, never the partially encoded snapshot.
      const observer = createLightback({ capture: noCapture, persistence: { attachments: true } }); clients.push(observer); await observer.ready;
      expect(observer.getDraft()?.text).toBe('committed'); observer.destroy(); await observer.flushPersistence();
      const clear = first.clearPersistence();
      for (const value of edits) first.saveDraft(draft(`new-${value}`));
      if (destroy) first.destroy();
      const queued = first.flushPersistence();
      encoded.resolve(new ArrayBuffer(5)); await write; await clear; await queued;
      first.destroy(); await first.flushPersistence();
      const next = createLightback({ capture: noCapture }); clients.push(next); await next.ready;
      expect(next.getDraft()?.text ?? null).toBe(edits.length ? `new-${edits.at(-1)}` : null);
      expect(next.getDraft()?.attachments ?? []).toEqual([]);
    } finally { encoded.resolve(new ArrayBuffer(5)); for (const client of clients) { client.destroy(); await client.flushPersistence(); } cleanupStorage(); }
  }), propertyParameters());
}, 120_000);

it('merges recovered events with startup activity in timestamp order within current limits', async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 15 }),
    fc.integer({ min: 1, max: 5 }), fc.boolean(), async (times, limit, enabled) => {
      setupStorage();
      const clients: LightbackClient[] = [];
      try {
        const first = createLightback({ capture: noCapture }); clients.push(first); await first.ready;
        first.saveDraft(draft('merge')); await first.flushPersistence(); first.destroy(); await first.flushPersistence();
        const entries = times.map((t, index) => ({ t, message: `old-${index}`, type: 'custom' }));
        await storedRecord((record) => {
          // Network requests can complete in an order different from their start timestamps.
          record.state.breadcrumbs = entries;
          record.state.console = entries.map((entry) => ({ ...entry, level: 'info' }));
          record.state.errors = entries.map((entry) => ({ ...entry, kind: 'error' }));
          record.state.network = entries.map((entry) => ({ ...entry, kind: 'fetch', method: 'GET', url: `https://test/${entry.message}`, requestBody: 'body', responseBody: 'body' }));
          return record;
        });
        const second = createLightback({ capture: { console: enabled, errors: enabled, network: enabled, breadcrumbs: true, networkBodies: false },
          limits: { console: limit, errors: limit, network: limit, breadcrumbs: limit } }); clients.push(second);
        second.addBreadcrumb('startup'); await second.ready;
        const sorted = [...entries].sort((a, b) => a.t - b.t);
        const expected = [...sorted.map((e) => e.message), 'startup'].slice(-limit);
        const payload = second.buildPayload({});
        expect(payload.breadcrumbs.map((e) => e.message)).toEqual(expected);
        for (const channel of ['console', 'errors', 'network'] as const) {
          expect(payload[channel].map((e) => 'url' in e ? e.url.split('/').pop() : e.message)).toEqual(enabled ? sorted.slice(-limit).map((e) => e.message) : []);
        }
        for (const entry of payload.network) { expect(entry.requestBody).toBeUndefined(); expect(entry.responseBody).toBeUndefined(); }
      } finally { for (const client of clients) { client.destroy(); await client.flushPersistence(); } cleanupStorage(); }
    },
  ), propertyParameters());
}, 120_000);
