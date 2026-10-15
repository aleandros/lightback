import { afterEach, expect, it, vi } from 'vitest';
import { createLightback } from '@lightback/core';
import { mountWidget } from '../src/ui';
import { settle } from '../../../test/property';

vi.mock('../src/screenshot', async (original) => ({
  ...await original<typeof import('../src/screenshot')>(),
  decodeScreenshot: async () => ({ width: 200, height: 100, close() {} }),
}));
const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((fn) => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(withCrop = false) {
  const encodes: BlobCallback[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, beginPath() {}, rect() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {} } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => { encodes.push(callback); });
  let nextUrl = 0;
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => `blob:annotations-${++nextUrl}`);
    static revokeObjectURL = vi.fn();
  });
  const deliver = vi.fn(async () => {});
  const client = createLightback({ persistence: false, send: deliver });
  const blob = new Blob(['masked'], { type: 'image/png' });
  const selection = { ...client.describeElement(document.body), crop: 'selection-1.png' };
  const image = { blob, type: blob.type, size: blob.size, area: { x: 0, y: 0, width: 200, height: 100 } };
  client.saveDraft({ text: 'edit', selections: withCrop ? [selection] : [], attachments: [
    { name: 'screenshot.png', ...image }, ...(withCrop ? [{ name: 'selection-1.png', ...image }] : []),
  ] });
  const widget = mountWidget({ client, screenshot: async () => blob, autoScreenshot: false });
  cleanup.push(() => client.destroy(), () => widget.destroy());
  const click = (action: string) => widget.element.shadowRoot!.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!.click();
  await settle(); widget.open(); click('annotate-shot'); await settle();
  return { widget, client, encodes, click, deliver };
}

it.each(['discard', 'destroy'])('late annotation encoding cannot revive images after %s', async (action) => {
  const { widget, client, encodes, click, deliver } = await setup();
  click('annotation-add'); await settle(); expect(encodes).toHaveLength(1);
  widget.open(); click('send'); await settle(); expect(deliver).not.toHaveBeenCalled();
  if (action === 'discard') click('discard'); else widget.destroy();
  const save = vi.spyOn(client, 'saveDraft');
  encodes[0]!(new Blob(['edited'], { type: 'image/png' })); await settle();
  expect(save).not.toHaveBeenCalled(); expect(deliver).not.toHaveBeenCalled();
  if (action === 'discard') expect(client.getDraft()).toBeNull();
});

it('coalesces queued edits and sends only the final rendered image', async () => {
  const { widget, encodes, click, deliver } = await setup();
  click('annotation-add'); await settle();
  click('annotation-add'); click('annotation-reset'); click('annotation-add'); await settle();
  expect(encodes).toHaveLength(1);
  widget.open(); click('send'); await settle(); expect(deliver).not.toHaveBeenCalled();
  encodes[0]!(new Blob(['obsolete'], { type: 'image/png' })); await settle();
  expect(encodes).toHaveLength(2); expect(deliver).not.toHaveBeenCalled();
  const final = new Blob(['current'], { type: 'image/png' });
  encodes[1]!(final); await settle();
  expect(deliver).toHaveBeenCalledOnce();
  expect((deliver.mock.calls[0] as unknown as [unknown, { blob: Blob }[]])[1][0]!.blob).toBe(final);
});

it('retains edits on encoding failure and lets reset recover without sending stale pixels', async () => {
  const { widget, client, encodes, click, deliver } = await setup();
  click('annotation-add'); await settle(); encodes[0]!(null); await settle();
  widget.open(); click('send'); await settle();
  expect(deliver).not.toHaveBeenCalled();
  expect(client.getDraft()!.imageAnnotations![0]!.shapes).toHaveLength(1);
  click('annotate-shot'); await settle(); click('annotation-reset'); await settle();
  widget.open(); click('send'); await settle();
  expect(deliver).toHaveBeenCalledOnce();
});

it('does not overwrite endpoint typing when an earlier encode finishes', async () => {
  const { widget, client, encodes, click } = await setup();
  click('annotation-add'); await settle();
  const input = widget.element.shadowRoot!.querySelector<HTMLInputElement>('[data-ref=annotationX1]')!;
  input.value = '75'; input.dispatchEvent(new Event('input'));
  encodes[0]!(new Blob(['rectangle'], { type: 'image/png' })); await settle();
  expect(input.value).toBe('75');
  click('annotation-apply'); await settle();
  expect(client.getDraft()!.imageAnnotations![0]!.shapes[0]!.x1).toBe(.75);
  encodes[1]!(new Blob(['moved'], { type: 'image/png' })); await settle();
});

it('keeps the annotated preview when a new mask does not intersect the screenshot', async () => {
  const { widget, encodes, click } = await setup();
  click('annotation-add'); await settle(); encodes[0]!(new Blob(['edited'], { type: 'image/png' })); await settle();
  const img = widget.element.shadowRoot!.querySelector<HTMLImageElement>('[data-ref=shotImg]')!;
  const annotated = img.src;
  const target = document.createElement('div'); document.body.appendChild(target);
  cleanup.push(() => { target.remove(); delete (document as Partial<Document>).elementFromPoint; });
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 300, top: 0, right: 400, bottom: 100, x: 300, y: 0, width: 100, height: 100, toJSON() {} });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  widget.startPicking(); click('mask-mode'); target.click(); await settle();
  expect(img.src).toBe(annotated);
});

it('lets Done leave a failed crop and does not block another image editor on that error', async () => {
  const { widget, client, encodes, click, deliver } = await setup(true);
  widget.open(); click('annotate-crop'); await settle();
  click('annotation-add'); await settle(); encodes[0]!(null); await settle();
  click('annotation-select');
  const list = widget.element.shadowRoot!.querySelector<HTMLSelectElement>('[data-ref=annotationList]')!;
  list.dispatchEvent(new Event('change'));
  expect(widget.element.shadowRoot!.querySelector('[data-ref=annotationStatus]')!.textContent).toContain('Could not encode annotations');
  click('annotation-close'); await settle();
  const panel = widget.element.shadowRoot!.querySelector<HTMLElement>('[data-ref=panel]')!;
  expect(panel.hidden).toBe(false);
  click('annotate-shot'); await settle(); click('annotation-close'); await settle();
  expect(panel.hidden).toBe(false);
  click('send'); await settle(); expect(deliver).not.toHaveBeenCalled();
  expect(client.getDraft()!.imageAnnotations).toHaveLength(1);
});

it('does not replace a focused crop control when its annotation render completes', async () => {
  const { widget, encodes, click } = await setup(true);
  widget.open(); click('annotate-crop'); await settle(); click('annotation-add'); await settle();
  widget.open();
  const button = widget.element.shadowRoot!.querySelector<HTMLButtonElement>('[data-action=annotate-crop]')!;
  button.focus();
  encodes[0]!(new Blob(['edited'], { type: 'image/png' })); await settle();
  expect(button.isConnected).toBe(true);
  expect(widget.element.shadowRoot!.activeElement).toBe(button);
});
