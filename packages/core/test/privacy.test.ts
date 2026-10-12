import { afterEach, expect, it, vi } from 'vitest';
import { createLightback, type LightbackClient } from '../src/client';
import type { FeedbackPayload } from '../src/types';
import { describeElement, summarizeElement } from '../src/inspect';
import { deferred, settle } from '../../../test/property';
import { noCapture, selection } from './property-fixtures';

const clients: LightbackClient[] = [];
function client(options: Parameters<typeof createLightback>[0] = {}) {
  const instance = createLightback({ persistence: false, capture: noCapture, ...options });
  clients.push(instance);
  return instance;
}
afterEach(() => {
  clients.splice(0).reverse().forEach((instance) => instance.destroy());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  history.replaceState({}, '', '/'); document.body.innerHTML = ''; document.title = '';
});

it('redacts the complete payload before preview, beforeSend and delivery without mutating host data', async () => {
  history.replaceState({}, '', '/?token=page-secret'); document.title = 'private-title';
  vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://test/?password=referrer-secret');
  const failedFetch = vi.fn().mockRejectedValue(new Error('private-network'));
  vi.stubGlobal('fetch', failedFetch);
  const context = { nested: { message: 'private-context', authorization: 'header-secret' }, url: 'https://test/?access_token=context-secret', body: '{"password":"body-secret"}' };
  const inspect = vi.fn();
  const send = vi.fn(async (_payload: FeedbackPayload) => {});
  const instance = client({ context, capture: { network: true, errors: true }, redact: { patterns: [/private-[a-z]+/g] }, beforeSend: (p) => { inspect(p); return p; }, send });
  instance.addBreadcrumb('private-breadcrumb https://test/?token=breadcrumb-secret', { nested: { message: 'private-data', cookie: 'cookie-secret' } });
  window.dispatchEvent(new ErrorEvent('error', { message: 'private-error', filename: 'https://test/private-file?token=source-secret' }));
  await window.fetch('/private-request').catch(() => {});
  const picked = { ...selection('one'), text: 'private-selection', props: { password: 'prop-secret', ordinary: 'private-prop' }, attrs: { href: 'https://test/?token=attr-secret' } };
  const draft = { text: 'private-note', selections: [picked] };
  const preview = instance.buildPayload(draft);
  const delivered = await instance.send(draft);
  for (const payload of [preview, delivered, inspect.mock.calls[0]![0], send.mock.calls[0]![0]]) {
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/private-|page-secret|referrer-secret|context-secret|body-secret|header-secret|breadcrumb-secret|cookie-secret|source-secret|prop-secret|attr-secret/);
    expect(json).toContain('[redacted]');
  }
  expect(context.nested.message).toBe('private-context');
  expect(picked.text).toBe('private-selection');
});

it('redacts JSON transport and multipart filenames consistently with crop references', async () => {
  const request = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', request);
  const instance = client({ endpoint: '/feedback', redact: { patterns: [/private/g] } });
  instance.addBreadcrumb('private');
  await instance.send({ text: 'private' });
  expect(String((request.mock.calls[0] as unknown as [string, RequestInit])[1].body)).not.toContain('private');
  const blob = new Blob(['unchanged pixels'], { type: 'image/png' });
  const payload = await instance.send({ text: 'images', selections: [{ ...selection('one'), crop: 'private.png' }], attachments: [{ name: 'private.png', type: blob.type, size: blob.size, blob }] });
  const form = (request.mock.calls[1] as unknown as [string, RequestInit])[1].body as FormData;
  expect(payload!.attachments[0]!.name).toBe('[redacted].png');
  expect(payload!.selections[0]!.crop).toBe('[redacted].png');
  expect(form.get('[redacted].png')).toBeTruthy();
  expect(form.get('private.png')).toBeNull();
});

it('preserves JSON timestamps and redacts values produced by user serialization hooks', async () => {
  const request = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', request);
  const instance = client({ endpoint: '/feedback', redact: { patterns: [/private-[a-z]+/g] } });
  const time = new Date('2026-10-12T12:34:56Z');
  const metadata = { toJSON: () => ({ password: 'password-secret', label: 'private-label', time }) };
  instance.addBreadcrumb('event', { time, metadata });
  const payload = await instance.send({ selections: [{ ...selection('one'), props: { metadata } }] });
  expect(payload!.breadcrumbs[0]!.data).toEqual({ time: time.toISOString(), metadata: { password: '[redacted]', label: '[redacted]', time: time.toISOString() } });
  expect(payload!.selections[0]!.props).toEqual({ metadata: { password: '[redacted]', label: '[redacted]', time: time.toISOString() } });
  const body = String((request.mock.calls[0] as unknown as [string, RequestInit])[1].body);
  expect(body).not.toMatch(/password-secret|private-label/);
  expect(metadata.toJSON().password).toBe('password-secret');
});

it('never records editable contents when clicking controls, their descendants or containing elements', () => {
  document.body.innerHTML = `<section id="container">Safe label<textarea>textarea-secret</textarea><input value="input-secret"><select><option>option-secret</option></select><div contenteditable><span id="nested">typed-secret</span></div><div contenteditable="plaintext-only">plain-secret</div><button>Submit</button></section>`;
  const instance = client({ capture: { breadcrumbs: true } });
  for (const element of document.querySelectorAll('section, textarea, input, select, option, [contenteditable], span, button')) {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const details = JSON.stringify([describeElement(element), summarizeElement(element)]);
    expect(details).not.toMatch(/textarea-secret|input-secret|option-secret|typed-secret|plain-secret/);
  }
  const messages = instance.buildPayload({}).breadcrumbs.map((b) => b.message);
  expect(messages).toContain('button "Submit"');
  expect(messages.some((message) => message.includes('Safe label'))).toBe(true);
  expect(messages.join('\n')).not.toMatch(/textarea-secret|input-secret|option-secret|typed-secret|plain-secret/);
});

function response(url: string, text: string) {
  const res = new Response(text, { headers: { 'content-type': 'text/plain' } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

it.each(['https://other.test/private', '', 'data:text/plain,private'])('omits fetch response bodies unless final origin is verified: %s', async (finalUrl) => {
  vi.stubGlobal('fetch', vi.fn(async () => response(finalUrl, 'foreign response')));
  const instance = client({ capture: { network: true, networkBodies: true } });
  await window.fetch('/redirect', { method: 'POST', body: 'same-origin request' }); await settle();
  const [entry] = instance.buildPayload({}).network;
  expect(entry?.requestBody).toBe('same-origin request'); expect(entry?.responseBody).toBeUndefined();
});

it('retains verified same-origin bodies and returns an immutable payload snapshot', async () => {
  const body = deferred<string>();
  const res = response(new URL('/final', location.href).href, 'response');
  vi.spyOn(res, 'clone').mockReturnValue({ text: () => body.promise } as Response);
  vi.stubGlobal('fetch', vi.fn(async () => res));
  const instance = client({ capture: { network: true, networkBodies: true } });
  await window.fetch('/redirect');
  const before = instance.buildPayload({});
  body.resolve('{"password":"body-secret","message":"safe"}'); await settle();
  expect(before.network[0]!.responseBody).toBeUndefined();
  expect(instance.buildPayload({}).network[0]!.responseBody).toBe('{"password":"[redacted]","message":"safe"}');
});
