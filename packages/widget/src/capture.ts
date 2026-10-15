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
    const options: DomCaptureOptions = { width: area.width, height: area.height, style: {}, filter: captureFilter(area) };
    if (!coversPage(area)) {
      // Margins rather than a transform: a transformed root would carry fixed elements off the image.
      options.style = { marginTop: `${-area.y}px`, marginLeft: `${-area.x}px` };
    }
    return render(root, options);
  };
  return Object.assign(capture, { [OMITS_WIDGET]: true });
}

/** Elements the DOM capturer actually clones, with hidden subtrees rejected in both capture modes. */
export function captureCost(area: Rect): number {
  const filter = captureFilter(area);
  let count = 1; // The renderer always receives the document root.
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => filter(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  while (walker.nextNode()) count++;
  return count;
}

/** Cache layout queries for one walk/capture. Boxless display:contents wrappers still have rendered children. */
function notRendered(): (el: Element) => boolean {
  const seen = new WeakMap<Element, boolean>();
  return (el) => {
    let result = seen.get(el);
    if (result === undefined) {
      result = false;
      if (el.getClientRects().length === 0) {
        const display = getComputedStyle(el).display;
        // SVG paint resources (defs/gradients/clip paths) and wbr can affect visible pixels/layout without boxes.
        // Their hidden HTML/SVG ancestors are still rejected before the renderer reaches these nodes.
        const resource = el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName !== 'svg';
        result = display !== 'contents' && !(display !== 'none' && (resource || el.localName === 'wbr'));
      }
      seen.set(el, result);
    }
    return result;
  };
}

/** Share the exact pruning rules between the budget and the renderer, including paths to fixed descendants. */
function captureFilter(area: Rect): (node: Node) => boolean {
  const hidden = notRendered();
  const excluded = (node: Node) => {
    const parent = node.parentElement;
    // Some engines still expose rects for closed details content. Only its first summary is rendered.
    if (parent instanceof HTMLDetailsElement && !parent.open && node !== parent.querySelector(':scope > summary')) return true;
    return node instanceof Element && (node.localName === HOST_TAG || hidden(node));
  };
  if (coversPage(area)) return (node) => !excluded(node);
  const empty = emptiable(area, hidden);
  const root = document.documentElement;
  const keep = new Set<Element>();
  // Skip entire hidden trees here too; inspecting every hidden descendant's computed style defeats pruning.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => excluded(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    if (getComputedStyle(el).position !== 'fixed') continue;
    for (let a: Element | null = el; a && !keep.has(a); a = a.parentElement) keep.add(a);
  }
  return (node) => {
    if (excluded(node)) return false;
    const parent = node.parentElement;
    return !parent || parent === root || keep.has(parent) || !empty(parent);
  };
}

function coversPage(area: Rect): boolean {
  const root = document.documentElement;
  return area.x <= 0 && area.y <= 0 && area.x + area.width >= root.scrollWidth && area.y + area.height >= root.scrollHeight;
}

/**
 * Whether an element's contents can be left out of a capture of `area`: its box lies entirely outside the area and
 * nothing inside it renders beyond that box. Overflowing content (an app root with `height: 100%` on a long page,
 * positioned descendants) shows in scrollWidth/scrollHeight. Non-rendered subtrees are emptied too, while
 * `display: contents` wrappers keep their children. Memoized for one capture: a parent is asked once per child.
 */
function emptiable(area: Rect, hidden: (el: Element) => boolean): (el: Element) => boolean {
  const view = { x: area.x - window.scrollX, y: area.y - window.scrollY, width: area.width, height: area.height };
  const seen = new WeakMap<Element, boolean>();
  return (el) => {
    let result = seen.get(el);
    if (result === undefined) {
      if (hidden(el)) { seen.set(el, true); return true; }
      const r = el.getBoundingClientRect();
      const outside = r.bottom < view.y || r.top > view.y + view.height || r.right < view.x || r.left > view.x + view.width;
      result = outside && r.width + r.height > 0 && el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
      seen.set(el, result);
    }
    return result;
  };
}
