import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureWithinBudget, captureCost, domCapturer, OMITS_WIDGET, type DomCaptureOptions } from '../src/capture';

const rect = (top: number, height: number, width = 100) => ({ x: 0, y: top, width, height, left: 0, top, right: width, bottom: top + height, toJSON() {} });
const at = (id: string, top: number, height: number, width = 100) => vi.spyOn(document.getElementById(id)!, 'getBoundingClientRect').mockReturnValue(rect(top, height, width));
/** jsdom has no layout: give an element the scroll extents a browser would report for overflowing content. */
const overflowing = (id: string, scrollHeight: number) => {
  const el = document.getElementById(id)!;
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 100 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
};

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.closest('[hidden], [style*="display: none"]') || this.localName === 'head' || this.id === 'contents' || this.localName === 'wbr' || (this.namespaceURI === 'http://www.w3.org/2000/svg' && this.localName !== 'svg')
      ? [] : [rect(0, 0, 0)]) as unknown as DOMRectList;
  });
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
      <div id="app"><p id="app-child">overflows into view</p></div>
      <div id="contents"><p id="contents-child">no box of its own</p></div>
    </main>
    <lightback-widget id="widget"></lightback-widget>`;
  at('main', -400, 1000);
  at('above', -400, 300);
  at('above-child', -400, 20);
  at('fixed-host', -300, 10);
  at('fixed', 20, 40);
  at('visible', 0, 100);
  at('visible-child', 10, 20);
  at('below', 150, 300);
  at('below-child', 150, 20);
  at('app', -400, 100); // a height: 100% root above the viewport whose content overflows down into it
  overflowing('app', 2000);
  at('app-child', -400, 2000);
  document.getElementById('contents')!.style.display = 'contents';
  at('contents', 0, 0, 0); // display: contents measures 0x0
  at('contents-child', 30, 20);
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
  expect(kept(options, 'widget')).toBe(false);
  expect(captureCost({ x: 0, y: 0, width: 100, height: 1000 })).toBe(document.getElementsByTagName('*').length - 2); // head and widget excluded
});

it('marks itself as leaving the widget out, so the widget need not hide', () => {
  expect((domCapturer(async () => null) as unknown as Record<symbol, unknown>)[OMITS_WIDGET]).toBe(true);
});

it('never empties an element whose content renders outside its box', async () => {
  const options = await optionsFor({ x: 0, y: 400, width: 100, height: 100 });
  expect(kept(options, 'app-child')).toBe(true);
  expect(options.filter(document.getElementById('app-child')!.firstChild!)).toBe(true);
  expect(kept(options, 'contents-child')).toBe(true);
  expect(kept(options, 'widget')).toBe(false);
});

it('measures each element once per capture', async () => {
  document.getElementById('below')!.insertAdjacentHTML('beforeend', '<p>a</p><p>b</p><p>c</p>');
  const spy = vi.mocked(document.getElementById('below')!.getBoundingClientRect);
  spy.mockClear();
  const options = await optionsFor({ x: 0, y: 400, width: 100, height: 100 });
  for (const child of Array.from(document.getElementById('below')!.childNodes)) options.filter(child);
  expect(spy).toHaveBeenCalledTimes(1);
});

it('keeps off-screen elements as empty boxes for a viewport area, and every fixed element', async () => {
  document.getElementById('below-child')!.style.position = 'sticky'; // sticky is not exempt: it renders unstuck
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
  // Hidden head and widget are excluded. Off-screen boxes retain their size; the fixed element and
  // its ancestor path are counted along with visible content, overflowing content and display:contents children.
  expect(captureCost({ x: 0, y: 400, width: 100, height: 100 })).toBe(14);
  expect(captureCost({ x: 0, y: 0, width: 100, height: 1000 })).toBe(document.getElementsByTagName('*').length - 2); // head and widget excluded
});

it.each([100, 1000])('prunes a large hidden list for a capture height of %i', async (height) => {
  const area = { x: 0, y: 0, width: 100, height };
  const before = captureCost(area);
  document.body.insertAdjacentHTML('beforeend', `<ul id="mobile" style="display: none">${'<li><dl><dt>Label</dt><dd>Value</dd></dl></li>'.repeat(250)}</ul>`);
  const childRects = vi.spyOn(document.querySelector('#mobile li')!, 'getClientRects');
  expect(captureCost(area)).toBe(before);
  expect(childRects).not.toHaveBeenCalled();
  const options = await optionsFor(area);
  expect(kept(options, 'mobile')).toBe(false);
  expect(childRects).not.toHaveBeenCalled();
});

it('walks through display:contents and keeps zero-size rendered inline elements and SVG', async () => {
  document.getElementById('contents')!.insertAdjacentHTML('beforeend', '<span id="empty"></span><br id="br"><wbr id="wbr"><svg id="svg"><path id="path" /></svg>');
  const options = await optionsFor({ x: 0, y: 400, width: 100, height: 100 });
  for (const id of ['contents', 'contents-child', 'empty', 'br', 'wbr', 'svg', 'path']) expect(kept(options, id), id).toBe(true);
  const before = captureCost({ x: 0, y: 0, width: 100, height: 1000 });
  document.getElementById('contents')!.remove();
  expect(captureCost({ x: 0, y: 0, width: 100, height: 1000 })).toBe(before - 7);
});

it('does not resurrect a fixed descendant under a hidden root', async () => {
  document.getElementById('above')!.setAttribute('hidden', '');
  const options = await optionsFor({ x: 0, y: 400, width: 100, height: 100 });
  expect(kept(options, 'above')).toBe(false);
  expect(kept(options, 'fixed')).toBe(false);
});

it('reuses fixed-path discovery for budget and rendering but refreshes geometry', async () => {
  const area = { x: 0, y: 400, width: 100, height: 100 };
  const target = document.getElementById('visible-child')!;
  const rects = vi.spyOn(target, 'getClientRects');
  const styles = vi.spyOn(window, 'getComputedStyle');
  const render = vi.fn(async (_root: HTMLElement, options: DomCaptureOptions) => {
    expect(options.filter(target)).toBe(!target.hasAttribute('hidden'));
    return null;
  });
  const capture = domCapturer(render);
  const prepared = captureWithinBudget(capture, area, 8000);
  expect(prepared).not.toBeNull();
  await prepared!();
  expect(rects).toHaveBeenCalledTimes(2); // count and renderer each measure current geometry
  expect(styles.mock.calls.filter(([el]) => el === target)).toHaveLength(1); // one fixed-position discovery
  target.setAttribute('hidden', '');
  await capture({ area });
  expect(rects).toHaveBeenCalledTimes(4);
  expect(captureWithinBudget(capture, area, 1)).toBeNull();
  expect(render).toHaveBeenCalledTimes(2);
});

it('stops a whole-page budget count once the limit is exceeded', () => {
  const area = { x: 0, y: 0, width: 100, height: 1000 };
  const last = vi.spyOn(document.getElementById('contents-child')!, 'getClientRects');
  expect(captureCost(area, 2)).toBe(3);
  expect(last).not.toHaveBeenCalled();
});

it('retains boxless native select options and groups in both capture modes', async () => {
  document.getElementById('visible')!.insertAdjacentHTML('beforeend', '<select id="select"><optgroup id="group" label="Status"><option id="option" selected>Paid</option></optgroup></select>');
  for (const id of ['group', 'option']) vi.spyOn(document.getElementById(id)!, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
  for (const area of [{ x: 0, y: 400, width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 1000 }]) {
    const options = await optionsFor(area);
    expect(kept(options, 'group')).toBe(true);
    expect(kept(options, 'option')).toBe(true);
  }
});

it('measures boxes when an asynchronous renderer starts cloning', async () => {
  const area = { x: 0, y: 400, width: 100, height: 100 };
  const capture = domCapturer(async (_root, options) => {
    await Promise.resolve();
    at('below', 0, 50);
    at('below-child', 10, 20);
    expect(kept(options, 'below-child')).toBe(true);
    return null;
  });
  await captureWithinBudget(capture, area, 8000)!();
});

it('does not bypass a custom wrapper that copied the capturer properties', async () => {
  const render = vi.fn(async () => new Blob(['png']));
  const inner = domCapturer(render);
  const wrapped = Object.assign(vi.fn((request: Parameters<typeof inner>[0]) => inner(request)), inner);
  await captureWithinBudget(wrapped, { x: 0, y: 400, width: 100, height: 100 }, 8000)!();
  expect(wrapped).toHaveBeenCalledOnce();
  expect(render).toHaveBeenCalledOnce();
});
