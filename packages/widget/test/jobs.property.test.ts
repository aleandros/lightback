import fc from 'fast-check';
import { expect, it, vi } from 'vitest';
import { createLightback } from '@lightback/core';
import { mountWidget } from '../src/ui';
import { deferred, propertyParameters, settle } from '../../../test/property';

// Rasterization is a platform boundary; real browser coverage stays in e2e.
vi.mock('../src/screenshot', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/screenshot')>(),
  decodeScreenshot: async () => ({ width: 100, height: 100, close() {} }),
}));

async function run(steps: string[], send: boolean) {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 0; });
  const capture = deferred<Blob | null>();
  let completeCrop: BlobCallback | undefined;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, strokeRect() {}, setLineDash() {} } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => { completeCrop = callback; });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const target = document.createElement('button'); target.id = 'job-target'; document.body.appendChild(target);
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, width: 20, height: 20, left: 10, top: 10, right: 30, bottom: 30, toJSON() {} });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  for (const dimension of ['scrollWidth', 'scrollHeight']) Object.defineProperty(document.documentElement, dimension, { configurable: true, value: 100 });
  const deliver = vi.fn(async (_payload: import('@lightback/core').FeedbackPayload) => {});
  const onSent = vi.fn();
  const client = createLightback({ persistence: false, capture: { console: false, errors: false, network: false, breadcrumbs: false }, send: deliver });
  const widget = mountWidget({ client, screenshot: () => capture.promise, onSent });
  const click = (action: string) => widget.element.shadowRoot!.querySelector<HTMLButtonElement>(`[data-action=${action}]`)!.click();
  const model = { alive: true, cancelled: false, selected: true, screenshot: false, crop: false, captured: false, cropped: false, cropStarted: false, submitted: false };
  const check = () => {
    const current = client.getDraft();
    expect(current?.attachments.some((a) => a.name === 'screenshot.png') ?? false).toBe(model.screenshot);
    expect(current?.selections.length ?? 0).toBe(model.selected ? 1 : 0);
    expect(current?.attachments.some((a) => a.name === 'selection-1.png') ?? false).toBe(model.crop);
    expect(deliver).toHaveBeenCalledTimes(model.submitted ? 1 : 0);
    expect(onSent).toHaveBeenCalledTimes(model.submitted ? 1 : 0);
    if (model.submitted) {
      const payload = deliver.mock.calls[0]![0] as unknown as { attachments: { name: string }[]; selections: { crop?: string }[] };
      expect(payload.attachments.map((a) => a.name)).toContain('screenshot.png');
      if (payload.selections.length) expect(payload.attachments.map((a) => a.name)).toContain(payload.selections[0]!.crop);
    }
  };
  try {
    await settle(); widget.startPicking(); await settle(); target.click(); await settle();
    if (send) { widget.open(); click('send'); await settle(); }
    for (const step of steps) {
      if (step === 'capture' && !model.captured) {
        capture.resolve(new Blob(['base'], { type: 'image/png' })); model.captured = true;
        if (model.alive && !model.cancelled) { model.screenshot = true; model.cropStarted = model.selected; }
      }
      if (step === 'crop' && completeCrop && !model.cropped) {
        completeCrop(new Blob(['crop'], { type: 'image/png' })); model.cropped = true;
        if (model.alive && !model.cancelled && model.selected) model.crop = true;
      }
      if (step === 'remove' && model.alive && model.selected) {
        click('sel-remove'); model.selected = false; model.crop = false;
      }
      if (step === 'discard' && model.alive) {
        widget.open(); click('discard'); model.cancelled = true; model.screenshot = false; model.crop = false; model.selected = false;
      }
      if (step === 'destroy' && model.alive) { widget.destroy(); model.alive = false; model.cancelled = true; }
      await settle();
      if (send && !model.cancelled && !model.submitted && model.captured && (!model.cropStarted || model.cropped)) {
        model.submitted = true; model.selected = false; model.screenshot = false; model.crop = false;
      }
      check();
    }
  } finally {
    widget.destroy(); capture.resolve(null); completeCrop?.(null); await settle(); client.destroy(); target.remove();
    delete (document as Partial<Document>).elementFromPoint;
    for (const dimension of ['scrollWidth', 'scrollHeight']) delete (document.documentElement as unknown as Record<string, unknown>)[dimension];
    delete (URL as Partial<typeof URL>).createObjectURL; delete (URL as Partial<typeof URL>).revokeObjectURL;
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
}

it('models late screenshot/crop completion relative to removal, discard, destroy and sending', async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.constantFrom('capture', 'crop', 'remove', 'discard', 'destroy'), { maxLength: 12 }), fc.boolean(),
    (steps, send) => run([...steps, 'capture', 'crop'], send),
  ), propertyParameters());
}, 120_000);

it.each(['discard', 'destroy'])('regression: send waiting on a screenshot is cancelled by %s', async (cancel) => {
  await run([cancel, 'capture', 'crop'], true);
});

it('waits for the crop before sending both images', async () => {
  await run(['capture', 'crop'], true);
});

it('ignores transport callbacks after discard/destroy without aborting an already-started send', async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom('discard', 'destroy'), fc.boolean(), fc.string({ maxLength: 20 }), async (cancel, fail, text) => {
    const transport = deferred<void>();
    const deliver = vi.fn(() => transport.promise);
    const onSent = vi.fn();
    const onError = vi.fn();
    const client = createLightback({ persistence: false, capture: { console: false, errors: false, network: false, breadcrumbs: false }, send: deliver });
    const widget = mountWidget({ client, onSent, onError });
    try {
      await settle(); widget.open();
      const root = widget.element.shadowRoot!;
      const input = root.querySelector<HTMLTextAreaElement>('[data-ref=text]')!;
      input.value = `note ${text}`; input.dispatchEvent(new Event('input'));
      root.querySelector<HTMLButtonElement>('[data-action=send]')!.click(); await settle();
      expect(deliver).toHaveBeenCalledTimes(1);
      if (cancel === 'destroy') widget.destroy(); else root.querySelector<HTMLButtonElement>('[data-action=discard]')!.click();
      if (fail) transport.reject(new Error('offline')); else transport.resolve();
      await settle();
      expect(onSent).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
      if (cancel === 'destroy') expect(widget.element.isConnected).toBe(false);
      else expect(root.querySelector<HTMLElement>('[data-ref=panel]')!.hidden).toBe(true);
    } finally { widget.destroy(); transport.resolve(); await settle(); client.destroy(); }
  }), propertyParameters());
}, 120_000);
