import { composedClosest, domRoots, frameDocument, frameGeometry, toTopRect } from './dom';
import type { Rect } from './types';

/** Attribute that marks DOM subtrees whose content must never leave the page (text, HTML, attributes, props, pixels). */
export const SENSITIVE_ATTR = 'data-lightback-sensitive';
export const DEFAULT_SENSITIVE = `[${SENSITIVE_ATTR}]`;

/** Combine the attribute with host selectors. Invalid selectors throw: privacy configuration must not fail open. */
export function sensitiveSelector(selectors: readonly string[] = []): string {
  const extra = selectors.map((s) => s.trim()).filter(Boolean);
  const combined = [DEFAULT_SENSITIVE, ...extra].join(', ');
  if (typeof document !== 'undefined') {
    for (const selector of extra) {
      try {
        document.createDocumentFragment().querySelector(selector);
      } catch {
        throw new Error(`Lightback: invalid privacy selector ${JSON.stringify(selector)}`);
      }
    }
  }
  return combined;
}

/** True when `el` or any ancestor is sensitive. A selector error counts as sensitive. */
export function isSensitive(el: Element, selector = DEFAULT_SENSITIVE): boolean {
  try {
    return composedClosest(el, selector) !== null;
  } catch {
    return true;
  }
}

/** True when a descendant of `el` (not `el` itself) is sensitive. */
export function containsSensitive(el: Element, selector = DEFAULT_SENSITIVE): boolean {
  try {
    return domRoots(el).some(root => root.querySelector(selector) !== null);
  } catch {
    return true;
  }
}

/**
 * Document-space rectangles covering every rendered sensitive element, including content that overflows its box.
 * Fixed-position elements are reported where they are at the current scroll position.
 */
export function sensitiveRects(selector = DEFAULT_SENSITIVE, isIgnored: (el: Element) => boolean = () => false): Rect[] {
  if (typeof document === 'undefined' || typeof window === 'undefined') return [];
  const rects: Rect[] = [];
  const sx = window.scrollX;
  const sy = window.scrollY;
  const candidates = new Set<Element>();
  for (const root of domRoots(document, isIgnored)) {
    for (const el of Array.from(root.querySelectorAll(`${selector}, iframe`))) candidates.add(el);
    const host = (root as ShadowRoot).host;
    if (host && isSensitive(host, selector)) for (const el of Array.from(root.querySelectorAll('*'))) candidates.add(el);
    // Assigned content keeps its light-DOM root but inherits the slot's privacy boundary.
    for (const slot of Array.from(root.querySelectorAll('slot'))) if (isSensitive(slot, selector)) {
      candidates.add(slot);
      for (const el of (slot as HTMLSlotElement).assignedElements({ flatten: true })) {
        candidates.add(el);
        for (const nested of domRoots(el, isIgnored)) for (const child of Array.from(nested.querySelectorAll('*'))) candidates.add(child);
      }
    }
  }
  for (const el of candidates) {
    // Inaccessible/unsupported frames cannot vouch for their contents. Mask the whole frame.
    const opaque = el.localName === 'iframe' && (!frameDocument(el) || !frameGeometry(el));
    if (!opaque && !isSensitive(el, selector)) continue;
    if (isIgnored(el)) continue;
    const boxes = [el.getBoundingClientRect()];
    if (el.localName === 'slot') for (const node of (el as HTMLSlotElement).assignedNodes({ flatten: true })) {
      try {
        const range = el.ownerDocument.createRange();
        range.selectNode(node);
        if (typeof range.getBoundingClientRect === 'function') boxes.push(range.getBoundingClientRect());
      } catch { /* detached assignment */ }
    }
    // A range over the contents also covers overflowing text and positioned descendants.
    try {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      if (typeof range.getBoundingClientRect === 'function') boxes.push(range.getBoundingClientRect());
    } catch { /* detached or unsupported */ }
    const visible = boxes.filter((b) => b && b.width > 0 && b.height > 0);
    if (!visible.length) continue;
    const left = Math.min(...visible.map((b) => b.left));
    const top = Math.min(...visible.map((b) => b.top));
    const right = Math.max(...visible.map((b) => b.right));
    const bottom = Math.max(...visible.map((b) => b.bottom));
    const mapped = toTopRect({ x: left, y: top, width: right - left, height: bottom - top }, el.ownerDocument, true);
    const x = Math.floor(mapped.x + sx);
    const y = Math.floor(mapped.y + sy);
    rects.push({ x, y, width: Math.ceil(mapped.x + mapped.width + sx) - x, height: Math.ceil(mapped.y + mapped.height + sy) - y });
  }
  return rects;
}
