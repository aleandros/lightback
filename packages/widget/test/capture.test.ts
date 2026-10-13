import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureCost, domCapturer, type DomCaptureOptions } from '../src/capture';

const rect = (top: number, height: number) => ({ x: 0, y: top, width: 100, height, left: 0, top, right: 100, bottom: top + height, toJSON() {} });
const at = (id: string, top: number, height: number) => vi.spyOn(document.getElementById(id)!, 'getBoundingClientRect').mockReturnValue(rect(top, height));

beforeEach(() => {
  // A 100x1000 document scrolled to y=400, viewport 100x100. Viewport coordinates below.
  for (const [dimension, value] of [['scrollWidth', 100], ['scrollHeight', 1000]] as const) {
    Object.defineProperty(document.documentElement, dimension, { configurable: true, value });
  }
  vi.stubGlobal('scrollY', 400);
  document.body.innerHTML = `
    <main id="main">
      <section id="above"><p id="above-child">old</p><div id="fixed-host"><div id="fixed">modal</div></div></section>
      <section id="visible"><p id="visible-child">here</p></section>
      <section id="below"><p id="below-child">later</p></section>
    </main>`;
  at('main', -400, 1000);
  at('above', -400, 300);
  at('above-child', -400, 20);
  at('fixed-host', -300, 10);
  at('fixed', 20, 40);
  at('visible', 0, 100);
  at('visible-child', 10, 20);
  at('below', 150, 300);
  at('below-child', 150, 20);
  document.getElementById('fixed')!.style.position = 'fixed';
});
afterEach(() => {
  for (const dimension of ['scrollWidth', 'scrollHeight']) delete (document.documentElement as unknown as Record<string, unknown>)[dimension];
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function optionsFor(area: { x: number; y: number; width: number; height: number }) {
  let seen: DomCaptureOptions | undefined;
  const blob = new Blob(['png']);
  const capture = domCapturer(async (root, options) => {
    expect(root).toBe(document.documentElement);
    seen = options;
    return blob;
  });
  expect(await capture({ area })).toBe(blob);
  return seen!;
}

const kept = (options: DomCaptureOptions, id: string) => options.filter(document.getElementById(id)!);

it('captures a whole-page area unchanged', async () => {
  const options = await optionsFor({ x: 0, y: 0, width: 100, height: 1000 });
  expect(options.width).toBe(100);
  expect(options.height).toBe(1000);
  expect(options.style).toEqual({});
  expect(['above-child', 'below-child'].every((id) => kept(options, id))).toBe(true);
  expect(captureCost({ x: 0, y: 0, width: 100, height: 1000 })).toBe(document.getElementsByTagName('*').length);
});

it('keeps off-screen elements as empty boxes for a viewport area, and every fixed element', async () => {
  const options = await optionsFor({ x: 0, y: 400, width: 100, height: 100 });
  expect(options.style).toEqual({ marginTop: '-400px', marginLeft: '0px' });
  // The boxes themselves stay, so the layout around the viewport does not move.
  expect(kept(options, 'above')).toBe(true);
  expect(kept(options, 'below')).toBe(true);
  expect(kept(options, 'visible-child')).toBe(true);
  // Their contents are not cloned...
  expect(kept(options, 'below-child')).toBe(false);
  // ...except along the path to a fixed element, which renders on screen wherever its ancestors are. Siblings on
  // that path are still only boxes.
  expect(kept(options, 'fixed-host')).toBe(true);
  expect(kept(options, 'fixed')).toBe(true);
  expect(options.filter(document.getElementById('fixed')!.firstChild!)).toBe(true);
  expect(kept(options, 'above-child')).toBe(true);
  expect(options.filter(document.getElementById('above-child')!.firstChild!)).toBe(false);
});

it('counts what a viewport capture clones', () => {
  // html, head, body, main, the three sections, and visible-child; the off-screen sections' children are skipped.
  expect(captureCost({ x: 0, y: 400, width: 100, height: 100 })).toBe(8);
  expect(captureCost({ x: 0, y: 0, width: 100, height: 1000 })).toBe(12);
});
