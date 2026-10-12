import { afterEach, expect, it, vi } from 'vitest';
import { createLightback } from '@lightback/core';
import { mountWidget } from '../src/ui';

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((fn) => fn()); vi.restoreAllMocks(); });
function setup(screenshot?: () => Promise<Blob | null>) {
  const client = createLightback({ persistence: false });
  cleanup.push(() => client.destroy());
  client.saveDraft({ text: 'recover me', selections: [], attachments: [] });
  const widget = mountWidget({ client, screenshot });
  cleanup.push(() => widget.destroy());
  const q = (ref: string) => widget.element.shadowRoot!.querySelector<HTMLElement>(`[data-ref=${ref}]`)!;
  const action = (name: string) => widget.element.shadowRoot!.querySelector<HTMLButtonElement>(`[data-action=${name}]`)!.click();
  return { client, widget, q, action };
}

it('restores after ready and prevents editing before the saved draft is available', async () => {
  const { widget, q } = setup();
  widget.open();
  expect((q('text') as HTMLTextAreaElement).disabled).toBe(true);
  await vi.waitFor(() => expect((q('text') as HTMLTextAreaElement).value).toBe('recover me'));
  expect((q('text') as HTMLTextAreaElement).disabled).toBe(false);
  expect(q('pending').hidden).toBe(true);
  expect(widget.element.shadowRoot!.activeElement).toBe(q('text'));
});

it.each(['discard', 'destroy'])('late screenshot completion cannot revive a draft after %s', async (operation) => {
  let resolve!: (blob: Blob | null) => void;
  const screenshot = vi.fn(() => new Promise<Blob | null>((done) => { resolve = done; }));
  const { client, widget, q, action } = setup(screenshot);
  widget.open();
  await vi.waitFor(() => expect((q('text') as HTMLTextAreaElement).disabled).toBe(false));
  action('shot');
  await vi.waitFor(() => expect(screenshot).toHaveBeenCalled());
  if (operation === 'discard') action('discard'); else widget.destroy();
  const save = vi.spyOn(client, 'saveDraft');
  resolve(new Blob(['image'], { type: 'image/png' }));
  await new Promise((done) => setTimeout(done, 20));
  expect(save).not.toHaveBeenCalled();
  if (operation === 'discard') expect(client.getDraft()).toBeNull();
  else expect(widget.element.isConnected).toBe(false);
});

it('does not restore into a destroyed host', async () => {
  const { client, widget } = setup();
  const getDraft = vi.spyOn(client, 'getDraft');
  widget.destroy();
  await client.ready;
  expect(getDraft).not.toHaveBeenCalled();
});

it('retains memory-only compatibility with older core clients', async () => {
  const { client, widget } = setup(); widget.destroy();
  const legacy = { ...client, ready: undefined, getDraft: undefined, saveDraft: undefined, clearPersistence: undefined };
  const handle = mountWidget({ client: legacy as unknown as typeof client });
  cleanup.push(() => handle.destroy());
  handle.open();
  await Promise.resolve();
  const text = handle.element.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-ref=text]')!;
  text.value = 'legacy'; text.dispatchEvent(new Event('input'));
  expect(text.value).toBe('legacy');
  handle.element.shadowRoot!.querySelector<HTMLButtonElement>('[data-action=discard]')!.click();
  expect(text.value).toBe('');
});
