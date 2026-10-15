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
/** Internal handshake: budget and render share one snapshot without caching across unrelated captures. */
const PREPARE_CAPTURE = Symbol.for('lightback.prepareCapture');
type Capturer = (request: ScreenshotRequest) => Promise<Blob | null>;
type PreparedCapture = { filter: (node: Node) => boolean; capture: () => Promise<Blob | null> };

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
  const prepare = (area: Rect): PreparedCapture => {
    const root = document.documentElement;
    const filters = captureFilters(area);
    const options: DomCaptureOptions = { width: area.width, height: area.height, style: {}, filter: filters.filter };
    if (!coversPage(area)) {
      // Margins rather than a transform: a transformed root would carry fixed elements off the image.
      options.style = { marginTop: `${-area.y}px`, marginLeft: `${-area.x}px` };
    }
    return { filter: options.filter, capture: () => {
      // The renderer may clone after an await (font/module loading). Do not carry budget-time box decisions into it.
      options.filter = filters.fresh();
      return render(root, options);
    } };
  };
  const capture: Capturer = ({ area }) => prepare(area).capture();
  return Object.assign(capture, { [OMITS_WIDGET]: true, [PREPARE_CAPTURE]: { owner: capture, prepare } });
}

/** Elements the DOM capturer actually clones, with hidden subtrees rejected in both capture modes. */
export function captureCost(area: Rect, limit = Infinity): number {
  return countElements(captureFilters(area).filter, limit);
}

/** Prepare and budget a single capture. A custom capturer still uses the DOM estimate as before. */
export function captureWithinBudget(capturer: Capturer, area: Rect, limit: number): (() => Promise<Blob | null>) | null {
  const handshake = (capturer as { [PREPARE_CAPTURE]?: { owner: Capturer; prepare: (area: Rect) => PreparedCapture } })[PREPARE_CAPTURE];
  // Object.assign decorators may copy the symbol; only the original capturer may bypass its callback.
  const prepared = handshake?.owner === capturer ? handshake.prepare(area) : undefined;
  const cost = prepared ? countElements(prepared.filter, limit) : captureCost(area, limit);
  return cost > limit ? null : prepared?.capture ?? (() => capturer({ area }));
}

function countElements(filter: (node: Node) => boolean, limit: number): number {
  let count = 1; // The renderer always receives the document root.
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => filter(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  while (count <= limit && walker.nextNode()) count++;
  return count;
}

/** Cache layout queries for one walk/capture. Boxless display:contents wrappers still have rendered children. */
function notRendered(): (el: Element) => boolean {
  const seen = new WeakMap<Element, boolean>();
  return (el) => {
    let result = seen.get(el);
    if (result === undefined) {
      // No client rects alone does not mean no visible contribution: native select options, column
      // styles, display:contents, SVG definitions and word breaks can all be boxless. Selected native
      // options can supply the visible label even when hidden from the dropdown menu. A display:none
      // root safely excludes its entire subtree; closed details are handled separately below.
      const nativeOption = (el.localName === 'option' || el.localName === 'optgroup') && el.closest('select');
      result = !nativeOption && el.getClientRects().length === 0 && getComputedStyle(el).display === 'none';
      seen.set(el, result);
    }
    return result;
  };
}

/** Share the exact pruning rules between the budget and the renderer, including paths to fixed descendants. */
function captureFilters(area: Rect) {
  const hidden = notRendered();
  const excluded = (node: Node, isHidden = hidden) => {
    const parent = node.parentElement;
    // Some engines still expose rects for closed details content. Only its first summary is rendered.
    if (parent instanceof HTMLDetailsElement && !parent.open && node !== parent.querySelector(':scope > summary')) return true;
    return node instanceof Element && (node.localName === HOST_TAG || isHidden(node));
  };
  const wholePage = coversPage(area);
  const root = document.documentElement;
  const keep = new Set<Element>();
  // Skip entire hidden trees here too; inspecting every hidden descendant's computed style defeats pruning.
  if (!wholePage) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => excluded(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) {
      const el = walker.currentNode as Element;
      if (getComputedStyle(el).position !== 'fixed') continue;
      for (let a: Element | null = el; a && !keep.has(a); a = a.parentElement) keep.add(a);
    }
  }
  // Share the expensive fixed-path discovery, but let the renderer measure boxes when it actually clones.
  const build = (isHidden: (el: Element) => boolean) => {
    const empty = emptiable(area, isHidden);
    return (node: Node) => {
      if (excluded(node, isHidden)) return false;
      if (wholePage) return true;
      const parent = node.parentElement;
      return !parent || parent === root || keep.has(parent) || !empty(parent);
    };
  };
  return { filter: build(hidden), fresh: () => build(notRendered()) };
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
