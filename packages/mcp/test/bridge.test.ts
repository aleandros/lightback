import { request as httpRequest } from 'node:http';
import { scopePath } from '../src/types';
import { afterEach, describe, expect, it } from 'vitest';
import { startReceiver } from '../src/receiver';
import { ReportStore } from '../src/store';
import { config, payload, png, appRequest, agentRequest, json } from './helpers';
import type { Report } from '../src/types';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())); });
async function setup(options = {}) { const c = await config(); const r = await startReceiver(c, options); cleanup.push(r.close); return { c, r }; }

describe('queue semantics', () => {
  it('keeps IDs stable, rejects conflicting duplicates and bounds reports, bytes and retention', () => {
    let now = Date.now();
    const store = new ReportStore({ project: 'p', session: 's', maxReports: 1, retentionMs: 100, now: () => now });
    const p = payload(); const report = store.submit(p, new Map());
    expect(store.submit(p, new Map()).id).toBe(report.id);
    expect(store.list().cursor).toBe(1);
    expect(() => store.submit({ ...p, note: { text: 'changed' } }, new Map())).toThrow('different content');
    expect(() => store.submit(payload(), new Map())).toThrow('queue is full');
    now += 101;
    expect(store.list().reports).toHaveLength(0);
    expect(() => store.get(report.id)).toThrow('expired');
    expect(store.submit(payload(), new Map()).sequence).toBe(2);
    const tiny = new ReportStore({ project: 'p', session: 's', maxBytes: 1 });
    expect(() => tiny.submit(p, new Map())).toThrow('queue is full');
  });
  it('makes claims atomic and prevents an old result from resolving a newer follow-up', () => {
    const store = new ReportStore({ project: 'p', session: 's' });
    const report = store.submit(payload(), new Map());
    const claim = { messageId: 'claim-one', expectedRevision: 1, status: 'in_progress' as const, text: 'Working' };
    expect(store.message(report.id, claim, 'agent').revision).toBe(2);
    expect(store.message(report.id, claim, 'agent').revision).toBe(2);
    expect(() => store.message(report.id, { ...claim, messageId: 'claim-two' }, 'agent')).toThrow('Revision changed');
    store.message(report.id, { messageId: 'followup', expectedRevision: 2, text: 'Use green instead' }, 'reporter');
    expect(() => store.message(report.id, { ...claim, messageId: 'resolve', expectedRevision: 2, status: 'resolved' }, 'agent')).toThrow('Revision changed');
    expect(store.get(report.id).report.status).toBe('pending');
    expect(() => store.message(report.id, { ...claim, text: 'Different' }, 'agent')).toThrow('different content');
  });
  it('bounds messages, validates selection routing and cancels waiting without consuming reports', async () => {
    const store = new ReportStore({ project: 'p', session: 's' });
    const abort = new AbortController();
    const waiting = store.wait(0, 25_000, abort.signal); abort.abort();
    expect((await waiting).reports).toHaveLength(0);
    const pending = store.wait(0, 25_000);
    const report = store.submit(payload(), new Map());
    expect((await pending).reports[0]?.id).toBe(report.id);
    expect(store.list().reports).toHaveLength(1);
    expect(() => store.message(report.id, { messageId: 'bad', expectedRevision: 1, text: 'x', selectionId: 'absent' }, 'reporter')).toThrow('Unknown selection');
    for (let i = 0; i < 100; i++) store.message(report.id, { messageId: `m${i}`, expectedRevision: i + 1, text: 'x' }, 'reporter');
    expect(() => store.message(report.id, { messageId: 'last', expectedRevision: 101, text: 'x' }, 'reporter')).toThrow('Thread is full');
  });
});

describe('loopback receiver boundary', () => {
  it('isolates origins, project/session paths, browser access and agent credentials', async () => {
    const { c } = await setup();
    const p = payload();
    expect((await appRequest(c, '/reports', json(p))).status).toBe(201);
    expect((await appRequest(c, '/reports', { headers: { origin: 'http://evil.test' } })).status).toBe(403);
    expect((await appRequest(c, '/reports', { headers: { origin: 'null' } })).status).toBe(403);
    expect((await appRequest(c, '/reports', { headers: { 'x-lightback-token': 'wrong' } })).status).toBe(403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(c.url + scopePath(c) + '/reports', { headers: { host: 'evil.test', origin: c.origin, 'x-lightback-token': c.token } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
    });
    expect(badHost).toBe(403);
    expect((await appRequest({ ...c, project: 'other' }, '/reports')).status).toBe(404);
    expect((await appRequest({ ...c, session: 'other' }, '/reports')).status).toBe(404);
    expect((await appRequest(c, '/agent/reports', { headers: { authorization: `Bearer ${c.agentToken}` } })).status).toBe(403);
    expect((await agentRequest({ ...c, agentToken: c.token }, '/reports')).status).toBe(403);
    const secondConfig = await config('other-project', 'other-session');
    const second = await startReceiver(secondConfig); cleanup.push(second.close);
    expect((await agentRequest(secondConfig, `/reports/${p.id}`)).status).toBe(404);
    expect((await appRequest({ ...secondConfig, token: c.token }, '/reports')).status).toBe(403);
    expect((await agentRequest(c, '/reports')).status).toBe(200);
    const preflight = await appRequest(c, '/reports', { method: 'OPTIONS' });
    expect(preflight.headers.get('access-control-allow-origin')).toBe(c.origin);
    expect(preflight.headers.get('cache-control')).toBe('no-store');
  });
  it('accepts exact PNG metadata, preserves v1 extensions, and rejects forged attachments', async () => {
    const { c } = await setup();
    const p = { ...payload(), futureExtension: { works: true }, attachments: [{ name: 'selection-1.png', type: 'image/png', size: png.length, area: { x: 0, y: 0, width: 1, height: 1 } }] };
    const form = () => { const f = new FormData(); f.append('payload', JSON.stringify(p)); f.append('selection-1.png', new Blob([png], { type: 'image/png' }), 'selection-1.png'); return f; };
    const response = await appRequest(c, '/reports', { method: 'POST', body: form() });
    expect(response.status).toBe(201);
    expect((await response.json()).payload.futureExtension).toEqual({ works: true });
    const image = await agentRequest(c, `/reports/${p.id}/attachment?name=selection-1.png`);
    expect(Buffer.from((await image.json()).data, 'base64')).toEqual(png);
    expect((await appRequest(c, `/reports/${p.id}/attachment?name=selection-1.png`)).status).toBe(404);
    expect((await appRequest(c, '/reports', json(p))).status).toBe(400);
    const duplicate = form(); duplicate.append('selection-1.png', new Blob([png], { type: 'image/png' }), 'selection-1.png');
    expect((await appRequest(c, '/reports', { method: 'POST', body: duplicate })).status).toBe(400);
    const forged = form(); forged.set('selection-1.png', new Blob(['<svg/>'], { type: 'image/png' }), 'selection-1.png');
    expect((await appRequest(c, '/reports', { method: 'POST', body: forged })).status).toBe(400);
    const missing = form(); missing.set('payload', JSON.stringify({ ...p, attachments: [] }));
    expect((await appRequest(c, '/reports', { method: 'POST', body: missing })).status).toBe(400);
  });
  it('rejects malformed/deep/oversized JSON and unauthenticated uploads without filling the queue', async () => {
    const { c } = await setup();
    for (const value of [{}, { ...payload(), selections: [{}] }, { ...payload(), console: [{ level: 'unknown' }] }]) expect((await appRequest(c, '/reports', json(value))).status).toBe(400);
    let deep: unknown = {};
    for (let i = 0; i < 34; i++) deep = { child: deep };
    expect((await appRequest(c, '/reports', json({ ...payload(), context: { deep } }))).status).toBe(400);
    expect((await appRequest(c, '/reports', json({ ...payload(), note: { text: 'x'.repeat(1024 * 1024) } }))).status).toBe(413);
    expect((await appRequest(c, '/reports', { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await appRequest(c, '/reports', { ...json(payload()), headers: { origin: 'http://evil.test' } })).status).toBe(403);
    expect((await (await agentRequest(c, '/reports')).json()).reports).toHaveLength(0);
  });
  it('returns replies to the right thread, redacts follow-ups and exposes conflicts as 409', async () => {
    const { c } = await setup();
    const p = payload(); await appRequest(c, '/reports', json(p));
    const update = { messageId: 'reply', expectedRevision: 1, status: 'resolved', text: 'Changed button; tests pass' };
    expect((await agentRequest(c, `/reports/${p.id}/update`, json(update))).status).toBe(200);
    expect((await agentRequest(c, `/reports/${p.id}/update`, json(update))).status).toBe(200);
    const followup = { messageId: 'followup', expectedRevision: 2, text: 'Try https://app.test/?token=secret-value and 4111 1111 1111 1111' };
    const response = await appRequest(c, `/reports/${p.id}/messages`, json(followup));
    const report = await response.json() as Report;
    expect(report.status).toBe('pending'); expect(report.revision).toBe(3);
    expect(report.messages[1]?.text).not.toContain('secret-value');
    expect(report.messages[1]?.text).not.toContain('4111');
    expect((await agentRequest(c, `/reports/${p.id}/update`, json({ ...update, messageId: 'late', expectedRevision: 2 }))).status).toBe(409);
    expect((await appRequest(c, `/reports/${p.id}/update`, json({ ...update, expectedRevision: 3 }))).status).toBe(404);
  });
  it('waits for feedback, survives agent disconnects, and resets cursors on receiver restart', async () => {
    const { c, r } = await setup();
    const initial = await (await agentRequest(c, '/reports')).json();
    const wait = agentRequest(c, `/reports?after=0&instance=${initial.instance}&wait=1000`);
    const p = payload(); await appRequest(c, '/reports', json(p));
    expect((await (await wait).json()).reports[0].id).toBe(p.id);
    const controller = new AbortController();
    const aborted = agentRequest(c, `/reports?after=1&instance=${initial.instance}&wait=25000`, { signal: controller.signal });
    controller.abort(); await expect(aborted).rejects.toThrow();
    expect((await (await agentRequest(c, '/reports')).json()).reports).toHaveLength(1);
    await r.close(); cleanup.splice(cleanup.indexOf(r.close), 1);
    const next = await startReceiver(c); cleanup.push(next.close);
    const second = payload('after restart'); await appRequest(c, '/reports', json(second));
    const restarted = await (await agentRequest(c, `/reports?after=100&instance=${initial.instance}`)).json();
    expect(restarted.instance).not.toBe(initial.instance);
    expect(restarted.reports[0].id).toBe(second.id);
  });
});

it('bounds PNG uploads before queueing, including dimensions and undeclared files', async () => {
  const { c, r } = await setup();
  const form = (bytes: Buffer) => {
    const p = payload(); p.attachments = [{ name: 'screenshot.png', type: 'image/png', size: bytes.length }];
    const form = new FormData(); form.append('payload', JSON.stringify(p)); form.append('screenshot.png', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'screenshot.png'); return form;
  };
  expect((await appRequest(c, '/reports', { method: 'POST', body: form(Buffer.alloc(5 * 1024 * 1024 + 1)) })).status).toBe(400);
  const giant = Buffer.from(png); giant.writeUInt32BE(10000, 16); giant.writeUInt32BE(10000, 20);
  expect((await appRequest(c, '/reports', { method: 'POST', body: form(giant) })).status).toBe(400);
  expect((await appRequest(c, '/reports', { method: 'POST', headers: { connection: 'keep-alive' }, body: form(Buffer.alloc(10 * 1024 * 1024)) })).status).toBe(413);
  expect(r.store.list().reports).toHaveLength(0);
});

it('bounds simultaneous waiters and releases them on abort', async () => {
  const store = new ReportStore({ project: 'p', session: 's' });
  const controllers = Array.from({ length: 16 }, () => new AbortController());
  const waits = controllers.map(controller => store.wait(0, 25_000, controller.signal));
  await expect(store.wait(0, 25_000)).rejects.toThrow('Too many waiting');
  controllers.forEach(controller => controller.abort()); await Promise.all(waits);
  const report = store.submit(payload(), new Map());
  expect((await store.wait(0, 25_000)).reports[0]?.id).toBe(report.id);
});


it('keeps replies available while all report upload slots are occupied', async () => {
  const { c, r } = await setup();
  const report = payload(); await appRequest(c, '/reports', json(report));
  const pending: ReturnType<typeof httpRequest>[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const started = new Promise<void>(resolve => r.server.once('request', () => resolve()));
      const request = httpRequest(c.url + scopePath(c) + '/reports', {
        method: 'POST', headers: { origin: c.origin, 'x-lightback-token': c.token, 'content-type': 'application/json' },
      }, response => response.resume());
      request.on('error', () => {}); pending.push(request); request.write('{'); await started;
    }
    expect((await appRequest(c, '/reports', json(payload()))).status).toBe(429);
    expect((await agentRequest(c, `/reports/${report.id}/update`, json({ messageId: 'reply-during-upload', expectedRevision: 1, status: 'resolved', text: 'Completed' }))).status).toBe(200);
    expect((await appRequest(c, `/reports/${report.id}/messages`, json({ messageId: 'followup-during-upload', expectedRevision: 2, text: 'Reviewing now' }))).status).toBe(200);
  } finally { pending.forEach(request => request.destroy()); }
});
