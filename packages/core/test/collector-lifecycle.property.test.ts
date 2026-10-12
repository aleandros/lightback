import fc from 'fast-check';
import { afterEach, expect, it, vi } from 'vitest';
import { createLightback, type LightbackClient } from '../src/client';
import { deferred, propertyParameters, settle } from '../../../test/property';
import { cleanupStorage, noCapture, setupStorage, storedRecord } from './property-fixtures';

// The browser owns XHR completion. This boundary lets us order it explicitly.
class ControlledXHR extends EventTarget {
  status = 200;
  responseType = '';
  responseText = '';
  responseURL = '';
  open(_method: string, _url: string) {}
  send(_body?: string) {}
  finish(url = new URL('/final', location.href).href, body = 'response') {
    this.responseURL = url; this.responseText = body;
    this.dispatchEvent(new Event('loadend'));
  }
}
const clients: LightbackClient[] = [];
function client(options: Parameters<typeof createLightback>[0] = {}) {
  const instance = createLightback({ persistence: false, capture: noCapture, ...options }); clients.push(instance); return instance;
}
afterEach(() => { clients.splice(0).reverse().forEach((c) => c.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps each client collecting across every teardown order and restores the original methods', async () => {
  await fc.assert(fc.asyncProperty(fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }), async (order) => {
    vi.stubGlobal('XMLHttpRequest', ControlledXHR);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('response')));
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const originals = { info: console.info, fetch: window.fetch, open: ControlledXHR.prototype.open, send: ControlledXHR.prototype.send, push: history.pushState, replace: history.replaceState };
    const instances = Array.from({ length: 4 }, () => client({ capture: { console: true, network: true, breadcrumbs: true } }));
    const expected = instances.map(() => ({ console: 0, network: 0, breadcrumbs: 0 }));
    const active = new Set([0, 1, 2, 3]);
    try {
      for (const index of order) {
        instances[index]!.destroy(); active.delete(index);
        console.info('event'); await window.fetch('/event');
        const xhr = new ControlledXHR(); xhr.open('GET', '/event'); xhr.send(); xhr.finish();
        history.pushState({}, '', `/step-${index}`); history.replaceState({}, '', `/replace-${index}`);
        for (const i of active) { expected[i]!.console++; expected[i]!.network += 2; expected[i]!.breadcrumbs += 2; }
        instances.forEach((instance, i) => expect(instance.stats()).toMatchObject(expected[i]!));
      }
      expect(consoleInfo).toHaveBeenCalledTimes(4);
      expect(console.info).toBe(originals.info); expect(window.fetch).toBe(originals.fetch);
      expect(ControlledXHR.prototype.open).toBe(originals.open); expect(ControlledXHR.prototype.send).toBe(originals.send);
      expect(history.pushState).toBe(originals.push); expect(history.replaceState).toBe(originals.replace);
    } finally { instances.forEach((c) => c.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState({}, '', '/'); }
  }), propertyParameters());
});

it('does not overwrite a host wrapper installed after a collector', () => {
  const original = console.info;
  const instance = client({ capture: { console: true } });
  const captured = console.info;
  const host = vi.fn((...args: unknown[]) => captured(...args));
  console.info = host;
  try {
    instance.destroy(); console.info();
    expect(console.info).toBe(host); expect(host).toHaveBeenCalledTimes(1);
    expect(instance.stats().console).toBe(0);
  } finally { console.info = original; }
});

it.each(['clear', 'destroy', 'send'] as const)('invalidates pending fetch, XHR and body completions after %s', async (operation) => {
  const fetchResult = deferred<Response>();
  const responseBody = deferred<string>();
  vi.stubGlobal('XMLHttpRequest', ControlledXHR);
  const res = new Response('old response', { headers: { 'content-type': 'text/plain' } });
  Object.defineProperty(res, 'url', { value: new URL('/old', location.href).href });
  vi.spyOn(res, 'clone').mockReturnValue({ text: () => responseBody.promise } as Response);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res).mockReturnValueOnce(fetchResult.promise).mockResolvedValue(res));
  const instance = client({ capture: { network: true, networkBodies: true }, send: async () => {} });
  await window.fetch('/body-pending');
  const pending = window.fetch('/request-pending');
  const xhr = new ControlledXHR(); xhr.open('GET', '/xhr-pending'); xhr.send();
  const previous = instance.stats().network;
  if (operation === 'clear') await instance.clearPersistence();
  if (operation === 'destroy') instance.destroy();
  if (operation === 'send') await instance.send({ text: 'submit' });
  fetchResult.resolve(res); responseBody.resolve('late response'); xhr.finish(); await pending; await settle();
  expect(instance.stats().network).toBe(operation === 'destroy' ? previous : 0);
  expect(instance.buildPayload({}).network.some((e) => e.responseBody)).toBe(false);
  if (operation !== 'destroy') { await window.fetch('/new'); expect(instance.stats().network).toBe(1); }
});

it.each(['https://other.test/private', ''])('omits redirected/unknown XHR response bodies: %s', (url) => {
  vi.stubGlobal('XMLHttpRequest', ControlledXHR);
  const instance = client({ capture: { network: true, networkBodies: true } });
  const xhr = new ControlledXHR(); xhr.open('POST', '/redirect'); xhr.send('request'); xhr.finish(url, 'foreign response');
  expect(instance.buildPayload({}).network[0]).toMatchObject({ requestBody: 'request', status: 200 });
  expect(instance.buildPayload({}).network[0]!.responseBody).toBeUndefined();
});

it('allows same-origin XHR response bodies', () => {
  vi.stubGlobal('XMLHttpRequest', ControlledXHR);
  const instance = client({ capture: { network: true, networkBodies: true } });
  const xhr = new ControlledXHR(); xhr.open('GET', '/redirect'); xhr.send(); xhr.finish();
  expect(instance.buildPayload({}).network[0]!.responseBody).toBe('response');
});

it('cannot persist a late request after clear or restore it on recreation', async () => {
  setupStorage();
  const pending = deferred<Response>();
  vi.stubGlobal('fetch', vi.fn(() => pending.promise));
  const first = client({ persistence: {}, capture: { network: true } });
  let second: LightbackClient | undefined;
  try {
    await first.ready;
    const request = window.fetch('/old-user');
    await first.clearPersistence();
    pending.resolve(new Response('old response')); await request;
    await first.flushPersistence(); expect(await storedRecord()).toBeUndefined();
    first.destroy(); await first.flushPersistence();
    second = client({ persistence: {}, capture: { network: true } }); await second.ready;
    expect(second.stats().network).toBe(0);
  } finally {
    first.destroy(); await first.flushPersistence(); second?.destroy(); await second?.flushPersistence(); cleanupStorage();
  }
});
