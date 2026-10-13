import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { createLightback, type Attachment, type Draft, type FeedbackPayload } from '@lightback/core';
import { mountWidget } from '../src/ui';
import type { WidgetOptions } from '../src/types';
import { propertyParameters } from '../../../test/property';

// Rasterization is a platform boundary: a 200x100 bitmap for a 100x50 page (2x), recorded canvas calls.
const RAW = { width: 200, height: 100, close: vi.fn() };
vi.mock('../src/screenshot', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/screenshot')>(),
  decodeScreenshot: async () => RAW,
}));

interface Call { canvas: HTMLCanvasElement; op: string; args: unknown[] }
let calls: Call[] = [];
let encoded: Blob[] = [];
const canvasOf = new Map<Blob, HTMLCanvasElement>();
let noContext = false;
/** Hold encoder callbacks to complete them later; or encode `null` from the given call index on. */
let held: Array<() => void> | null = null;
let nullFrom = Infinity;
const cleanup: Array<() => void> = [];
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON() {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls = []; encoded = []; canvasOf.clear(); noContext = false; held = null; nullFrom = Infinity;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 0; });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (noContext) return null;
    const record = (op: string) => (...args: unknown[]) => { calls.push({ canvas: this, op, args }); };
    return { drawImage: record('drawImage'), fillRect: record('fillRect'), strokeRect: record('strokeRect'), setLineDash() {} } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
    const blob = new Blob([`encoded-${encoded.length}`], { type: 'image/png' });
    encoded.push(blob);
    canvasOf.set(blob, this);
    const done = () => callback(encoded.indexOf(blob) >= nullFrom ? null : blob);
    if (held) held.push(done); else queueMicrotask(done);
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  for (const [dimension, value] of [['scrollWidth', 100], ['scrollHeight', 50]] as const) {
    Object.defineProperty(document.documentElement, dimension, { configurable: true, value });
  }
  document.body.innerHTML = '<div id="secret" data-lightback-sensitive>secret-ssn</div><button id="target">Pay</button>';
  vi.spyOn(document.getElementById('secret')!, 'getBoundingClientRect').mockReturnValue(rect(10, 5, 20, 10));
  vi.spyOn(document.getElementById('target')!, 'getBoundingClientRect').mockReturnValue(rect(50, 20, 10, 10));
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.getElementById('target') });
});
afterEach(() => {
  cleanup.splice(0).reverse().forEach((fn) => fn());
  delete (document as Partial<Document>).elementFromPoint;
  for (const dimension of ['scrollWidth', 'scrollHeight']) delete (document.documentElement as unknown as Record<string, unknown>)[dimension];
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function setup(options: { draft?: Draft; screenshot?: boolean; widget?: Partial<WidgetOptions> } = {}) {
  const raw = new Blob(['raw-pixels'], { type: 'image/png' });
  const capturer = vi.fn(async () => raw);
  const send = vi.fn(async (_payload: FeedbackPayload, _attachments: Attachment[]) => {});
  const onError = vi.fn();
  const client = createLightback({ persistence: false, capture: { console: false, errors: false, network: false, breadcrumbs: false }, send });
  if (options.draft) client.saveDraft(options.draft);
  const widget = mountWidget({ client, sendDelay: 0, onError, ...(options.screenshot === false ? {} : { screenshot: capturer }), ...options.widget });
  cleanup.push(() => widget.destroy(), () => client.destroy());
  const root = widget.element.shadowRoot!;
  const q = (ref: string) => root.querySelector<HTMLElement>(`[data-ref=${ref}]`)!;
  const action = (name: string) => root.querySelector<HTMLButtonElement>(`[data-action=${name}]`)!.click();
  const attachment = (name: string) => client.getDraft()?.attachments.find((a) => a.name === name)?.blob;
  const fills = () => calls.filter((c) => c.op === 'fillRect').map((c) => c.args);
  const area = (name: string) => client.getDraft()?.attachments.find((a) => a.name === name)?.area;
  return { raw, client, widget, q, action, attachment, area, fills, send, onError, capturer };
}

it('captures the viewport on request and maps masks and crops by its offset', async () => {
  // A 100x50 viewport scrolled 20px down; the capturer's 200x100 bitmap is that viewport at 2x.
  for (const [dimension, value] of [['clientWidth', 100], ['clientHeight', 50]] as const) {
    Object.defineProperty(document.documentElement, dimension, { configurable: true, value });
  }
  vi.stubGlobal('scrollY', 20);
  cleanup.push(() => { for (const d of ['clientWidth', 'clientHeight']) delete (document.documentElement as unknown as Record<string, unknown>)[d]; });
  const { widget, attachment, area, fills, capturer } = setup({ widget: { screenshotArea: 'viewport' } });
  await settle(); widget.startPicking();
  await vi.waitFor(() => expect(attachment('screenshot.png')).toBeDefined());
  expect(capturer).toHaveBeenCalledWith({ area: { x: 0, y: 20, width: 100, height: 50 } });
  expect(area('screenshot.png')).toEqual({ x: 0, y: 20, width: 100, height: 50 });
  // The sensitive element sits at document {10,25,20,10}: 5px into the viewport, so the same pixels as unscrolled.
  expect(fills()).toEqual([[16, 6, 48, 28]]);
  document.getElementById('target')!.click();
  await vi.waitFor(() => expect(attachment('selection-1.png')).toBeDefined());
  // Target at document {50,40,10,10} plus 16px padding, clipped to the captured area.
  expect(area('selection-1.png')).toEqual({ x: 34, y: 24, width: 42, height: 42 });
  const stroke = calls.filter((c) => c.op === 'strokeRect').at(-1)!;
  expect(stroke.args).toEqual([32, 32, 20, 20]);
});

it('skips the automatic capture over the element budget and says so', async () => {
  const { widget, q, attachment, capturer } = setup({ widget: { screenshotMaxElements: 1 } });
  await settle(); widget.startPicking();
  await settle();
  expect(capturer).not.toHaveBeenCalled();
  expect(q('toast').hidden).toBe(false);
  expect(q('toast').textContent).toContain('Large page');
  document.getElementById('target')!.click();
  await settle();
  expect(attachment('screenshot.png')).toBeUndefined();
  expect(attachment('selection-1.png')).toBeUndefined();
});

it('paints sensitive elements out of the screenshot and every crop before anything is stored', async () => {
  const { raw, widget, attachment, fills, client } = setup();
  await settle(); widget.startPicking();
  await vi.waitFor(() => expect(attachment('screenshot.png')).toBeDefined());
  // Page rect {10,5,20,10} at 2x, with a 2 CSS px bleed.
  expect(fills()).toEqual([[16, 6, 48, 28]]);
  expect(attachment('screenshot.png')).not.toBe(raw);
  expect(attachment('screenshot.png')).toBe(encoded[0]);
  expect(client.getDraft()!.masks).toEqual([{ docRect: { x: 10, y: 5, width: 20, height: 10 }, reason: 'sensitive' }]);
  document.getElementById('target')!.click();
  await vi.waitFor(() => expect(attachment('selection-1.png')).toBeDefined());
  // Crops are cut from the masked canvas, never the capturer's bitmap.
  const cropDraw = calls.filter((c) => c.op === 'drawImage').at(-1)!;
  expect(cropDraw.args[0]).toBeInstanceOf(HTMLCanvasElement);
  expect(cropDraw.args[0]).not.toBe(RAW);
  expect(RAW.close).toHaveBeenCalled();
});

it('withholds the content of a picked sensitive element in the selection card', async () => {
  const { widget, q } = setup({ screenshot: false });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.getElementById('secret') });
  await settle(); widget.startPicking();
  document.getElementById('secret')!.click();
  widget.open();
  expect(q('sensitive')).not.toBeNull();
  expect(q('selections').textContent).not.toContain('secret-ssn');
  expect(q('maskMode').hidden).toBe(true);
});

it('lets the reporter hide an area, repainting the screenshot and re-cutting earlier crops', async () => {
  const { widget, q, action, attachment, fills, send } = setup();
  await settle(); widget.startPicking();
  document.getElementById('target')!.click();
  await vi.waitFor(() => expect(attachment('selection-1.png')).toBeDefined());
  const crop = attachment('selection-1.png');
  const shot = attachment('screenshot.png');
  action('pop-more');
  action('mask-mode');
  expect(q('maskMode').getAttribute('aria-pressed')).toBe('true');
  expect(q('pickHint').textContent).toContain('hide');
  document.getElementById('target')!.click(); // a click in mask mode hides the element instead of selecting it
  await vi.waitFor(() => expect(attachment('selection-1.png')).not.toBe(crop));
  expect(attachment('screenshot.png')).not.toBe(shot);
  expect(fills()).toContainEqual([96, 36, 28, 28]); // {50,20,10,10} at 2x with bleed
  expect(widget.element.shadowRoot!.querySelectorAll('.lb-mask')).toHaveLength(1);
  expect(widget.element.shadowRoot!.querySelectorAll('.lb-pin')).toHaveLength(1);
  action('done'); action('send');
  await vi.waitFor(() => expect(send).toHaveBeenCalled());
  expect(send.mock.calls[0]![0].masks).toEqual([
    { docRect: { x: 10, y: 5, width: 20, height: 10 }, reason: 'sensitive' },
    { docRect: { x: 50, y: 20, width: 10, height: 10 }, reason: 'reporter' },
  ]);
});

it('fails closed when pixels cannot be masked', async () => {
  noContext = true;
  const { widget, attachment, onError, client } = setup();
  await settle(); widget.startPicking();
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(attachment('screenshot.png')).toBeUndefined();
  expect(client.getDraft()?.attachments ?? []).toEqual([]);
});

it('keeps a capture untouched when nothing is sensitive or hidden', async () => {
  document.getElementById('secret')!.removeAttribute('data-lightback-sensitive');
  const { raw, widget, attachment, fills } = setup();
  await settle(); widget.startPicking();
  await vi.waitFor(() => expect(attachment('screenshot.png')).toBe(raw));
  expect(fills()).toEqual([]);
});

it('restores reporter masks and applies them to later captures; drops restored images it cannot re-mask', async () => {
  const restored = new Blob(['restored'], { type: 'image/png' });
  const draft: Draft = {
    text: 'recovered', selections: [], attachments: [{ name: 'screenshot.png', type: 'image/png', size: restored.size, blob: restored }],
    masks: [{ docRect: { x: 0, y: 0, width: 5, height: 5 }, reason: 'reporter' }],
  };
  const { widget, attachment, fills, client } = setup({ draft });
  await settle();
  expect(client.getDraft()!.masks).toEqual(draft.masks);
  widget.startPicking();
  await vi.waitFor(() => expect(attachment('screenshot.png')).not.toBe(restored));
  expect(fills()).toEqual(expect.arrayContaining([[0, 0, 14, 14], [16, 6, 48, 28]]));
});

it('property: every sensitive element and reporter mask is painted into the lineage of each sent image', async () => {
  // A fill reaches an image through every canvas the image was drawn from.
  const lineage = (canvas: HTMLCanvasElement): unknown[][] => calls.filter((c) => c.canvas === canvas).flatMap((c) =>
    c.op === 'fillRect' ? [c.args] : c.op === 'drawImage' && c.args[0] instanceof HTMLCanvasElement ? lineage(c.args[0]) : []);
  const drag = (x: number, y: number, w: number, h: number) => {
    // Browsers follow a drag with a click on the common ancestor; the picker swallows it.
    for (const [type, cx, cy] of [['mousedown', x, y], ['mousemove', x + w, y + h], ['mouseup', x + w, y + h], ['click', x + w, y + h]] as const) {
      document.dispatchEvent(new MouseEvent(type, { clientX: cx, clientY: cy, button: 0, bubbles: true }));
    }
  };
  const area = fc.record({ x: fc.integer({ min: 0, max: 90 }), y: fc.integer({ min: 0, max: 40 }), w: fc.integer({ min: 6, max: 40 }), h: fc.integer({ min: 6, max: 20 }) });
  const runs = Math.min(propertyParameters().numRuns ?? 60, 25);
  await fc.assert(fc.asyncProperty(fc.array(fc.oneof(area, fc.constant('select' as const)), { minLength: 1, maxLength: 5 }), async (steps) => {
    calls = []; encoded = []; canvasOf.clear();
    const { widget, action, send } = setup();
    try {
      await settle(); widget.startPicking();
      let maskMode = false;
      const expected: number[][] = [[16, 6, 48, 28]];
      for (const step of steps) {
        if ((step === 'select') === maskMode) { action('mask-mode'); maskMode = !maskMode; }
        if (step === 'select') { document.getElementById('target')!.click(); action('pop-more'); continue; }
        drag(step.x, step.y, step.w, step.h);
        // Page rect at 2x with a 2 CSS px bleed, clamped to the 200x100 bitmap.
        const x0 = Math.max(0, (step.x - 2) * 2); const y0 = Math.max(0, (step.y - 2) * 2);
        expected.push([x0, y0, Math.min(200, (step.x + step.w + 2) * 2) - x0, Math.min(100, (step.y + step.h + 2) * 2) - y0]);
      }
      action('done');
      const note = widget.element.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-ref=text]')!;
      note.value = 'masked'; note.dispatchEvent(new Event('input'));
      action('send');
      await vi.waitFor(() => expect(send).toHaveBeenCalled());
      const [payload, attachments] = send.mock.calls[0]!;
      expect(payload.masks!.filter((m) => m.reason === 'reporter')).toHaveLength(expected.length - 1);
      for (const attachment of attachments) {
        const canvas = canvasOf.get(attachment.blob);
        expect(canvas, attachment.name).toBeDefined();
        expect(lineage(canvas!)).toEqual(expect.arrayContaining(expected));
      }
      expect(attachments.map((a) => a.name)).toEqual(['screenshot.png', ...payload.selections.map((_, i) => `selection-${i + 1}.png`)]); expect(payload.selections.length).toBe(steps.filter((s) => s === 'select').length);
    } finally { widget.destroy(); }
  }), { ...propertyParameters(), numRuns: runs });
}, 120_000);

const area = (x0: number, y0: number, x1: number, y1: number) => {
  for (const [type, x, y] of [['mousedown', x0, y0], ['mousemove', x1, y1], ['mouseup', x1, y1], ['click', x1, y1]] as const) {
    document.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true }));
  }
};

it('regression: a failed mask also discards a crop that was still being cut', async () => {
  const { widget, action, attachment, onError } = setup();
  await settle(); widget.startPicking();
  await vi.waitFor(() => expect(attachment('screenshot.png')).toBeDefined());
  held = [];
  document.getElementById('target')!.click(); // crop encoding is held
  await settle();
  action('pop-more'); action('mask-mode');
  noContext = true;
  area(40, 15, 70, 35);
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  for (const done of held.splice(0)) done();
  held = null;
  await settle();
  expect(attachment('screenshot.png')).toBeUndefined();
  expect(attachment('selection-1.png')).toBeUndefined();
});

it('regression: an overlapping crop is dropped before re-cutting, so a failed re-cut leaves no stale crop', async () => {
  const { widget, action, attachment } = setup();
  await settle(); widget.startPicking();
  document.getElementById('target')!.click();
  await vi.waitFor(() => expect(attachment('selection-1.png')).toBeDefined());
  nullFrom = encoded.length + 1; // the repaint encodes; the re-cut fails
  action('pop-more'); action('mask-mode');
  area(40, 15, 70, 35);
  await vi.waitFor(() => expect(encoded.length).toBe(nullFrom + 1));
  await settle();
  expect(attachment('selection-1.png')).toBeUndefined();
  expect(attachment('screenshot.png')).toBe(encoded[nullFrom - 1]);
});

it('keeps crops that a new mask does not touch', async () => {
  const { widget, action, attachment } = setup();
  await settle(); widget.startPicking();
  document.getElementById('target')!.click();
  await vi.waitFor(() => expect(attachment('selection-1.png')).toBeDefined());
  const crop = attachment('selection-1.png');
  const encodes = encoded.length;
  action('pop-more'); action('mask-mode');
  area(80, 0, 95, 10); // outside the target's padded crop
  await vi.waitFor(() => expect(encoded.length).toBe(encodes + 1)); // only the repaint
  await settle();
  expect(attachment('selection-1.png')).toBe(crop);
});

it('a click mask covers content overflowing the element box', async () => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect(50, 20, 45, 12) });
  try {
    const { widget, action, client } = setup();
    await settle(); widget.startPicking();
    action('mask-mode');
    document.getElementById('target')!.click();
    expect(client.getDraft()!.masks!.find((m) => m.reason === 'reporter')!.docRect).toEqual({ x: 50, y: 20, width: 45, height: 12 });
  } finally {
    delete (Range.prototype as Partial<Range>).getBoundingClientRect;
  }
});
