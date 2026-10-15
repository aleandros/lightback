import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createLightback, describeElement, type LightbackClient, type LightbackOptions } from '../src/index';

const clients: LightbackClient[] = [];
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  sessionStorage.clear();
});
afterEach(async () => {
  for (const client of clients.splice(0)) { client.destroy(); await client.flushPersistence(); }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function client(options: LightbackOptions = {}) {
  const instance = createLightback({ capture: { console: false, errors: false, network: false, breadcrumbs: false }, ...options });
  clients.push(instance);
  return instance;
}
async function record(update?: (value: any) => any) {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('lightback-recovery', 1);
    request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise<any>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      const key = sessionStorage.getItem('lightback:session:default')!;
      const request = store.get(key);
      let value: any;
      request.onsuccess = () => { value = request.result; if (update) store.put(update(value), key); };
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const draft = (text = 'unfinished') => ({ text, selections: [], attachments: [] });

it('recovers bounded context, merges events captured during startup, and retains the draft', async () => {
  const first = client({ capture: { breadcrumbs: true }, limits: { breadcrumbs: 2 } });
  await first.ready;
  first.addBreadcrumb('oldest'); first.addBreadcrumb('previous');
  first.saveDraft(draft());
  await first.flushPersistence();
  first.destroy(); await first.flushPersistence();
  const second = client({ capture: { breadcrumbs: true }, limits: { breadcrumbs: 2 } });
  second.addBreadcrumb('new startup');
  await second.ready;
  expect(second.buildPayload({}).breadcrumbs.map((b) => b.message)).toEqual(['previous', 'new startup']);
  expect(second.getDraft()?.text).toBe('unfinished');
  expect(second.getDraft()).not.toBe(second.getDraft());
});

it('scrubs before storage, removes form values/HTML, and honors stricter capture settings on restore', async () => {
  const first = client({ capture: { breadcrumbs: true }, redact: { patterns: [/private-name/g] } });
  await first.ready;
  document.body.innerHTML = '<section>Label<textarea>input-secret</textarea><input value="input-secret"></section>';
  const selection = describeElement(document.querySelector('section')!);
  selection.props = { value: 'input-secret', defaultValue: 'input-secret', authorization: 'header-secret', name: 'private-name' };
  selection.note = 'private-name https://host/?token=query-secret';
  first.saveDraft({ ...draft('private-name'), selections: [selection] });
  first.addBreadcrumb('https://host/?token=query-secret', { password: 'data-secret', nested: { cookie: 'cookie-secret' } });
  await first.flushPersistence();
  const stored = JSON.stringify(await record());
  for (const secret of ['input-secret', 'header-secret', 'private-name', 'query-secret', 'data-secret', 'cookie-secret']) expect(stored).not.toContain(secret);
  expect(stored).not.toContain('"html"');
  expect(stored).toContain('[redacted]');
  const second = client();
  await second.ready;
  expect(second.stats().breadcrumbs).toBe(0);
});

it.each(['expiry', 'schema', 'malformed'])('drops %s records', async (kind) => {
  const first = client(); await first.ready;
  first.saveDraft(draft()); await first.flushPersistence();
  await record((value) => {
    if (kind === 'expiry') value.expiresAt = Date.now() - 1;
    if (kind === 'schema') value.version = 999;
    if (kind === 'malformed') value.state.draft.selections = null;
    return value;
  });
  const second = client(); await second.ready;
  expect(second.getDraft()).toBeNull();
  expect(await record()).toBeUndefined();
});

it('preserves a draft on failed/vetoed send and deletes recovery data after success or discard', async () => {
  let mode = 'fail';
  const instance = client({
    beforeSend: (payload) => mode === 'veto' ? null : payload,
    send: async () => { if (mode === 'fail') throw new Error('offline'); },
  });
  await instance.ready;
  instance.saveDraft(draft()); await instance.flushPersistence();
  await expect(instance.send(draft())).rejects.toThrow('offline');
  expect((await record()).state.draft.text).toBe('unfinished');
  mode = 'veto'; expect(await instance.send(draft())).toBeNull();
  expect(instance.getDraft()?.text).toBe('unfinished');
  mode = 'success'; await instance.send(draft());
  expect(await record()).toBeUndefined();
  expect(instance.getDraft()).toBeNull();
  instance.saveDraft(draft('discard')); await instance.clearPersistence();
  await instance.flushPersistence();
  expect(await record()).toBeUndefined();
});

it('clear and new edits win over a pending restore and queued checkpoint', async () => {
  const first = client(); await first.ready;
  first.saveDraft(draft()); await first.flushPersistence();
  const second = client();
  const clear = second.clearPersistence();
  await clear; await second.ready;
  expect(second.getDraft()).toBeNull();
  second.saveDraft(draft('new'));
  await second.flushPersistence();
  expect((await record()).state.draft.text).toBe('new');
});

it('handles denied storage, quota failures and oversized records without breaking send', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  const disabled = client({ persistence: false }); await disabled.ready;
  disabled.saveDraft(draft()); await disabled.flushPersistence();
  expect(open).not.toHaveBeenCalled();
  const denied = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  const unavailable = client({ send: async () => {} }); await unavailable.ready;
  unavailable.saveDraft(draft()); await unavailable.flushPersistence();
  await expect(unavailable.send(draft())).resolves.toBeTruthy();
  denied.mockRestore();
  const limited = client({ persistence: { maxBytes: 1 } }); await limited.ready;
  limited.saveDraft(draft()); await limited.flushPersistence();
  expect(await record()).toBeUndefined();
  const quota = client({ send: async () => {} }); await quota.ready;
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  quota.saveDraft(draft()); await quota.flushPersistence();
  expect(sessionStorage.getItem('lightback:session:default')).toBeNull();
  await expect(quota.send(draft())).resolves.toBeTruthy();
  put.mockRestore();
});

it('isolates namespaces and tabs with fresh session storage', async () => {
  const first = client(); await first.ready;
  first.saveDraft(draft()); await first.flushPersistence();
  const otherApp = client({ persistence: { key: 'other-app' } }); await otherApp.ready;
  expect(otherApp.getDraft()).toBeNull();
  sessionStorage.clear();
  const otherTab = client(); await otherTab.ready;
  expect(otherTab.getDraft()).toBeNull();
});

it('keeps configured buffer capacities above the defaults', async () => {
  const first = client({ capture: { breadcrumbs: true }, limits: { breadcrumbs: 250 } });
  await first.ready;
  for (let index = 0; index < 300; index++) first.addBreadcrumb(`event ${index}`);
  await first.flushPersistence();
  const second = client({ capture: { breadcrumbs: true }, limits: { breadcrumbs: 250 } });
  await second.ready;
  const entries = second.buildPayload({}).breadcrumbs;
  expect(entries).toHaveLength(250);
  expect(entries[0]!.message).toBe('event 50');
  expect(entries[249]!.message).toBe('event 299');
});

it('a shorter expiry in another namespace does not delete a valid record', async () => {
  const first = client(); await first.ready;
  first.saveDraft(draft()); await first.flushPersistence();
  await record((value) => ({ ...value, savedAt: Date.now() - 1000 }));
  const other = client({ persistence: { key: 'short-lived', maxAge: 1 } }); await other.ready;
  expect((await record()).state.draft.text).toBe('unfinished');
});

it('drops malformed selections without preventing recovery of a valid note', async () => {
  const first = client(); await first.ready;
  first.saveDraft(draft()); await first.flushPersistence();
  await record((value) => { value.state.draft.selections = [null, { kind: 'region', region: { children: [null] } }]; return value; });
  const second = client(); await second.ready;
  expect(second.getDraft()?.text).toBe('unfinished');
  expect(second.getDraft()?.selections).toEqual([]);
});


it('stores opted-in attachments as bounded binary data and restores exact bytes', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('ArrayBuffer', (await new NodeBlob([]).arrayBuffer()).constructor);
  const first = client({ persistence: { attachments: true, maxBytes: 4096 } }); await first.ready;
  document.body.innerHTML = '<button>Target</button>';
  const selection = { ...describeElement(document.querySelector('button')!), crop: 'selection-1.png' };
  const small = new Blob(['exact image bytes'], { type: 'image/png' });
  const read = vi.spyOn(small, 'arrayBuffer');
  const large = new Blob(['x'.repeat(5000)], { type: 'image/png' });
  first.saveDraft({ text: 'images', selections: [selection], attachments: [
    { name: 'screenshot.png', type: large.type, size: large.size, blob: large },
    { name: 'selection-1.png', type: small.type, size: small.size, area: { x: 4, y: 900, width: 80, height: 40 }, blob: small },
  ] });
  await first.flushPersistence();
  read.mockRejectedValue(new DOMException('Blob revoked on navigation', 'NotReadableError'));
  await first.flushPersistence();
  expect(read).toHaveBeenCalledTimes(1);
  const stored = await record();
  expect(stored.state.draft.attachments).toHaveLength(1);
  expect(stored.state.draft.attachments[0].data).toBeInstanceOf(ArrayBuffer);
  const second = client({ persistence: { attachments: true } }); await second.ready;
  const recovered = second.getDraft()!;
  expect(recovered.attachments).toHaveLength(1);
  expect(await recovered.attachments[0]!.blob.text()).toBe('exact image bytes');
  expect(recovered.attachments[0]!.area).toEqual({ x: 4, y: 900, width: 80, height: 40 });
  expect(recovered.selections[0]!.crop).toBe('selection-1.png');
  const metadataOnly = client(); await metadataOnly.ready;
  expect(metadataOnly.getDraft()?.attachments).toEqual([]);
  expect(metadataOnly.getDraft()?.selections[0]?.crop).toBeUndefined();
  await metadataOnly.flushPersistence();
  expect((await record()).state.draft.attachments).toEqual([]);
  expect((await record()).state.draft.selections[0].crop).toBeUndefined();
});


it('preserves recovery field names with a one-character string limit', async () => {
  const instance = client({ limits: { string: 1 }, redact: { patterns: [/private-secret/g] } });
  await instance.ready;
  instance.saveDraft(draft('private-secret'));
  await instance.flushPersistence();
  expect(instance.getDraft()?.text).toBe('[');
  expect((await record()).state.draft.text).toBe('[');
});


it('sorts recovered request timestamps before applying a smaller buffer limit', async () => {
  const first = client(); await first.ready;
  first.saveDraft(draft()); await first.flushPersistence(); first.destroy(); await first.flushPersistence();
  await record((value) => {
    value.state.network = [
      { t: 2, kind: 'fetch', method: 'GET', url: 'https://test/newer' },
      { t: 1, kind: 'fetch', method: 'GET', url: 'https://test/older' },
    ];
    return value;
  });
  const next = client({ capture: { network: true }, limits: { network: 1 } }); await next.ready;
  expect(next.buildPayload({}).network.map((e) => e.url)).toEqual(['https://test/newer']);
});

it('validates and bounds draft-only annotation layers without truncating geometry with string limits', async () => {
  const instance = client({ persistence: false, limits: { string: 1 } });
  const blob = new Blob(['masked pixels'], { type: 'image/png' });
  const shape = { kind: 'arrow' as const, x1: .9, y1: .1, x2: .1, y2: .9 };
  instance.saveDraft({ ...draft(), attachments: [{ name: 'x', type: blob.type, size: blob.size, blob }], imageAnnotations: [
    { attachment: 'x', shapes: [shape, { ...shape, x1: NaN }, { ...shape, x2: 2 }, { ...shape, kind: 'script' as 'arrow' }] },
    { attachment: 'missing', shapes: [shape] },
  ] });
  const saved = instance.getDraft()!;
  expect(saved.imageAnnotations).toEqual([{ attachment: 'x', shapes: [shape] }]);
  saved.imageAnnotations![0]!.shapes[0]!.x1 = 0;
  expect(instance.getDraft()!.imageAnnotations![0]!.shapes[0]!.x1).toBe(.9);
  expect(instance.buildPayload(saved)).not.toHaveProperty('imageAnnotations');
  instance.saveDraft({ ...saved, imageAnnotations: Array.from({ length: 100 }, () => ({ attachment: 'x', shapes: Array(100).fill(shape) })) });
  expect(instance.getDraft()!.imageAnnotations).toHaveLength(51);
  expect(instance.getDraft()!.imageAnnotations![0]!.shapes).toHaveLength(50);
});

it.each([false, true])('recovers editable annotation layers only with retained image bytes (attachments=%s)', async (attachments) => {
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('ArrayBuffer', (await new NodeBlob([]).arrayBuffer()).constructor);
  const first = client({ persistence: { attachments } }); await first.ready;
  const blob = new Blob(['masked original'], { type: 'image/png' });
  const imageAnnotations = [{ attachment: 'screenshot.png', shapes: [{ kind: 'ellipse' as const, x1: .1, y1: .2, x2: .7, y2: .8 }, { kind: 'text' as const, text: 'Fix this label', x1: .2, y1: .4, x2: .8, y2: .5 }] }];
  first.saveDraft({ ...draft(), attachments: [{ name: 'screenshot.png', type: blob.type, size: blob.size, blob }], imageAnnotations });
  await first.flushPersistence(); first.destroy(); await first.flushPersistence();
  expect((await record()).state.draft.imageAnnotations).toEqual(attachments ? imageAnnotations : []);
  const second = client({ persistence: { attachments } }); await second.ready;
  expect(second.getDraft()!.imageAnnotations).toEqual(attachments ? imageAnnotations : []);
  if (attachments) expect(await second.getDraft()!.attachments[0]!.blob.text()).toBe('masked original');
});

it('validates text annotation content, scrubs before truncation, and drops extra text on other marks', () => {
  const instance = client({ persistence: false, redact: { patterns: [/private-.+/g] } });
  const blob = new Blob(['masked'], { type: 'image/png' });
  const geometry = { x1: .1, y1: .2, x2: .7, y2: .8 };
  instance.saveDraft({ ...draft(), attachments: [{ name: 'x', type: blob.type, size: blob.size, blob }], imageAnnotations: [{ attachment: 'x', shapes: [
    { kind: 'text', ...geometry, text: 'private-' + 'x'.repeat(400) },
    { kind: 'text', ...geometry, text: 'a'.repeat(300) },
    { kind: 'text', ...geometry, text: 'one\ntwo' },
    { kind: 'text', ...geometry },
    { kind: 'text', ...geometry, text: 42 as unknown as string },
    { kind: 'ellipse', ...geometry, text: 'discard this' },
  ] }] });
  const shapes = instance.getDraft()!.imageAnnotations![0]!.shapes;
  expect(shapes).toHaveLength(4);
  expect(shapes[0]!.text).not.toContain('private-');
  expect(shapes[1]!.text).toHaveLength(200);
  expect(shapes[2]!.text).toBe('one two');
  expect(shapes[3]).not.toHaveProperty('text');
});
