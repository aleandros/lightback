import { afterEach, expect, it, vi } from 'vitest';
import { createLightback } from '@lightback/core';
import { createLazyWidget } from '../src/lazy-controller';
import { mountWidget } from '../src/ui';
import type { WidgetOptions } from '../src/types';

const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).reverse().forEach((fn) => fn()));
function setup(options: Partial<WidgetOptions> = {}, loader = vi.fn(async () => ({ mountWidget }))) {
  const client = createLightback({ send: async () => {} });
  cleanup.push(() => client.destroy());
  const handle = createLazyWidget({ client, ...options }, loader);
  cleanup.push(() => handle.destroy());
  const q = (ref: string) => handle.element.shadowRoot!.querySelector<HTMLElement>(`[data-ref=${ref}]`);
  return { client, handle, loader, q };
}
function deferred() {
  let resolve!: (value: { mountWidget: typeof mountWidget }) => void;
  const promise = new Promise<{ mountWidget: typeof mountWidget }>((done) => { resolve = done; });
  return { resolve, loader: vi.fn(() => promise) };
}

it('starts collectors without loading UI, then preserves the host, options and early context', async () => {
  const label = '<img src=x onerror=alert(1)> Report';
  const { client, handle, loader, q } = setup({ theme: 'dark', position: 'bottom-left', accent: 'red', triggerLabel: 'Legacy', strings: { pillOpen: label } });
  const host = handle.element;
  host.style.setProperty('--lb-radius', '20px');
  const container = document.createElement('section');
  document.body.appendChild(container);
  container.appendChild(host);
  cleanup.push(() => container.remove());
  expect(loader).not.toHaveBeenCalled();
  expect(q('panel')).toBeNull();
  expect(q('pillOpen')?.textContent).toBe(label);
  expect(host.shadowRoot!.querySelector('img')).toBeNull();
  client.addBreadcrumb('before UI');
  await handle.open();
  expect(handle.element).toBe(host);
  expect(host.parentElement).toBe(container);
  expect(host.dataset.theme).toBe('dark');
  expect(host.dataset.position).toBe('bottom-left');
  expect(host.style.getPropertyValue('--lb-radius')).toBe('20px');
  expect(q('panel')?.hidden).toBe(false);
  expect(q('pillOpen')?.textContent).toBe(label);
  expect(client.buildPayload({ text: 'test' }).breadcrumbs.some((b) => b.message === 'before UI')).toBe(true);
  expect(loader).toHaveBeenCalledTimes(1);
});

it('coalesces interactions while loading and activates the latest action once', async () => {
  const wait = deferred();
  const { handle, q } = setup({}, wait.loader);
  const mount = vi.fn(mountWidget);
  const first = handle.open();
  const second = handle.startPicking();
  expect(first).toBe(second);
  wait.resolve({ mountWidget: mount });
  await second;
  expect(wait.loader).toHaveBeenCalledTimes(1);
  expect(mount).toHaveBeenCalledTimes(1);
  expect(q('panel')?.hidden).toBe(true);
  expect(handle.element.shadowRoot!.querySelector<HTMLElement>('.lb-pickbar')?.hidden).toBe(false);
  expect(q('count')?.textContent).toBe('0 selected');
});

it('keeps a custom trigger hidden through loading and close', async () => {
  const client = createLightback();
  cleanup.push(() => client.destroy());
  const handle = createLazyWidget({ client, hideTrigger: true }, async () => ({ mountWidget }));
  cleanup.push(() => handle.destroy());
  const root = handle.element.shadowRoot!;
  expect(root.querySelector<HTMLElement>('[data-ref=pill]')?.hidden).toBe(true);
  await handle.open();
  expect(root.querySelector<HTMLElement>('[data-ref=panel]')?.hidden).toBe(false);
  handle.close();
  expect(root.querySelector<HTMLElement>('[data-ref=pill]')?.hidden).toBe(true);
});

it('reports a load failure, retains the trigger, and retries on the next click', async () => {
  const error = new Error('offline');
  const onError = vi.fn();
  const loader = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ mountWidget });
  const { handle, q } = setup({ onError, strings: { loadFailed: 'Reintenta' } }, loader);
  await expect(handle.open()).rejects.toBe(error);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith(error);
  expect(q('loadStatus')?.textContent).toBe('Reintenta');
  q('pillPick')!.click();
  await vi.waitFor(() => expect(q('count')?.textContent).toBe('0 selected'));
  expect(loader).toHaveBeenCalledTimes(2);
});

it('close cancels pending activation and a later interaction still works', async () => {
  const wait = deferred();
  const { handle, q } = setup({}, wait.loader);
  const pending = handle.open();
  handle.close();
  wait.resolve({ mountWidget });
  await pending;
  expect(q('panel')).toBeNull();
  await handle.open();
  expect(q('panel')?.hidden).toBe(false);
});

it('destroy during download prevents mounting, callbacks and resurrection', async () => {
  const wait = deferred();
  const { handle } = setup({}, wait.loader);
  const mount = vi.fn(mountWidget);
  const pending = handle.open();
  handle.destroy(); handle.destroy();
  wait.resolve({ mountWidget: mount });
  await pending;
  await handle.startPicking();
  expect(mount).not.toHaveBeenCalled();
  expect(handle.element.isConnected).toBe(false);
});

it('independent mounts can load and tear down without destroying collectors', async () => {
  const { client, handle: first } = setup();
  const second = createLazyWidget({ client }, async () => ({ mountWidget }));
  cleanup.push(() => second.destroy());
  first.destroy();
  await second.open();
  second.destroy();
  client.addBreadcrumb('after destroy');
  expect(client.buildPayload({ text: '' }).breadcrumbs.some((b) => b.message === 'after destroy')).toBe(true);
  expect(document.querySelector('lightback-widget')).toBeNull();
});

it('does not call onError when a destroyed mount finishes with a failed download', async () => {
  let reject!: (error: Error) => void;
  const onError = vi.fn();
  const loader = vi.fn(() => new Promise<{ mountWidget: typeof mountWidget }>((_, fail) => { reject = fail; }));
  const { handle } = setup({ onError }, loader);
  const pending = handle.open();
  await Promise.resolve();
  handle.destroy();
  reject(new Error('offline'));
  await expect(pending).rejects.toThrow('offline');
  expect(onError).not.toHaveBeenCalled();
});
