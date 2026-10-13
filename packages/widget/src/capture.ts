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

/**
 * Build a `screenshot` capturer from a renderer that clones the DOM into an image, such as modern-screenshot's
 * `domToBlob` or html-to-image's `toBlob`. Cloning costs time per element, so for an area smaller than the page
 * (`screenshotArea: 'viewport'`) elements entirely outside the area are kept as empty boxes: their size holds the
 * layout in place, and nothing inside them is cloned. Fixed and sticky elements are always kept.
 */
export function domCapturer(
  render: (root: HTMLElement, options: DomCaptureOptions) => Promise<Blob | null>,
): (request: ScreenshotRequest) => Promise<Blob | null> {
  return ({ area }) => {
    const root = document.documentElement;
    const options: DomCaptureOptions = { width: area.width, height: area.height, style: {}, filter: () => true };
    if (coversPage(area)) return render(root, options);
    // Margins rather than a transform: a transformed root would carry fixed elements off the image.
    options.style = { marginTop: `${-area.y}px`, marginLeft: `${-area.x}px` };
    const view = toViewport(area);
    // Fixed and sticky elements render on screen wherever their ancestors are; keep the path to each of them.
    const keep = new Set<Element>();
    for (const el of Array.from(document.body.getElementsByTagName('*'))) {
      const position = getComputedStyle(el).position;
      if (position !== 'fixed' && position !== 'sticky') continue;
      for (let a: Element | null = el; a && !keep.has(a); a = a.parentElement) keep.add(a);
    }
    options.filter = (node) => {
      const parent = node.parentElement;
      return !parent || parent === root || keep.has(parent) || !outside(parent, view);
    };
    return render(root, options);
  };
}

/** Elements `domCapturer` clones for `area`: everything for the whole page, else what it cannot reduce to a box. */
export function captureCost(area: Rect): number {
  if (coversPage(area)) return document.getElementsByTagName('*').length;
  const view = toViewport(area);
  let count = 0;
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      count++;
      return outside(node as Element, view) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode());
  return count + 1;
}

function coversPage(area: Rect): boolean {
  const root = document.documentElement;
  return area.x <= 0 && area.y <= 0 && area.x + area.width >= root.scrollWidth && area.y + area.height >= root.scrollHeight;
}

/** A document-space area in viewport coordinates, as getBoundingClientRect reports them. */
function toViewport(area: Rect): Rect {
  return { x: area.x - window.scrollX, y: area.y - window.scrollY, width: area.width, height: area.height };
}

function outside(el: Element, view: Rect): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom < view.y || r.top > view.y + view.height || r.right < view.x || r.left > view.x + view.width;
}
