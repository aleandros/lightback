import type { Rect } from '@lightback/core';
import type { ScreenshotRequest } from './types';

/** Options a DOM-cloning renderer needs to draw one document area (modern-screenshot and html-to-image take these). */
export interface DomCaptureOptions {
  width: number;
  height: number;
  /** Applied to the cloned root: shifts the document so the area's corner is at the image origin. */
  style: Record<string, string>;
  /** Keeps a cloned node when it returns true. */
  filter: (node: Node) => boolean;
}

/** Marks capturers that leave the widget out of the image themselves, so the widget need not hide during capture. */
export const OMITS_WIDGET = Symbol.for('lightback.omitsWidget');
/** Tag of the widget's host element (see shell.ts). */
const HOST_TAG = 'lightback-widget';

/**
 * Build a `screenshot` capturer from a renderer that clones the DOM into an image, such as modern-screenshot's
 * `domToBlob` or html-to-image's `toBlob`. Cloning costs time per element, so for an area smaller than the page
 * (`screenshotArea: 'viewport'`) an element entirely outside the area, whose content cannot spill out of its box, is
 * kept as an empty box: its size holds the layout in place, and nothing inside it is cloned. Fixed elements are always
 * kept. The widget is left out of the image, so it stays visible and focused while the capture runs.
 */
export function domCapturer(
  render: (root: HTMLElement, options: DomCaptureOptions) => Promise<Blob | null>,
): (request: ScreenshotRequest) => Promise<Blob | null> {
  const capture = ({ area }: ScreenshotRequest) => {
    const root = document.documentElement;
    const widget = (node: Node) => node instanceof Element && node.localName === HOST_TAG;
    const options: DomCaptureOptions = { width: area.width, height: area.height, style: {}, filter: (node) => !widget(node) };
    if (coversPage(area)) return render(root, options);
    // Margins rather than a transform: a transformed root would carry fixed elements off the image.
    options.style = { marginTop: `${-area.y}px`, marginLeft: `${-area.x}px` };
    const empty = emptiable(area);
    // Fixed elements render on screen wherever their ancestors are; keep the path to each of them.
    const keep = new Set<Element>();
    for (const el of Array.from(document.body.getElementsByTagName('*'))) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      for (let a: Element | null = el; a && !keep.has(a); a = a.parentElement) keep.add(a);
    }
    options.filter = (node) => {
      if (widget(node)) return false;
      const parent = node.parentElement;
      return !parent || parent === root || keep.has(parent) || !empty(parent);
    };
    return render(root, options);
  };
  return Object.assign(capture, { [OMITS_WIDGET]: true });
}

/** Elements `domCapturer` clones for `area`: everything for the whole page, else what it cannot reduce to a box. */
export function captureCost(area: Rect): number {
  if (coversPage(area)) return document.getElementsByTagName('*').length;
  const empty = emptiable(area);
  let count = 0;
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      count++;
      return empty(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode());
  return count + 1;
}

function coversPage(area: Rect): boolean {
  const root = document.documentElement;
  return area.x <= 0 && area.y <= 0 && area.x + area.width >= root.scrollWidth && area.y + area.height >= root.scrollHeight;
}

/**
 * Whether an element's contents can be left out of a capture of `area`: its box lies entirely outside the area and
 * nothing inside it renders beyond that box. Overflowing content (an app root with `height: 100%` on a long page,
 * positioned descendants) shows in scrollWidth/scrollHeight; `display: contents` and other boxless elements measure
 * 0×0 and are never emptied. Memoized for one capture: a parent is asked once per child.
 */
function emptiable(area: Rect): (el: Element) => boolean {
  const view = { x: area.x - window.scrollX, y: area.y - window.scrollY, width: area.width, height: area.height };
  const seen = new WeakMap<Element, boolean>();
  return (el) => {
    let result = seen.get(el);
    if (result === undefined) {
      const r = el.getBoundingClientRect();
      const outside = r.bottom < view.y || r.top > view.y + view.height || r.right < view.x || r.left > view.x + view.width;
      result = outside && r.width + r.height > 0 && el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
      seen.set(el, result);
    }
    return result;
  };
}
