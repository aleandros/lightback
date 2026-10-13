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
    return el.closest(selector) !== null;
  } catch {
    return true;
  }
}

/** True when a descendant of `el` (not `el` itself) is sensitive. */
export function containsSensitive(el: Element, selector = DEFAULT_SENSITIVE): boolean {
  try {
    return el.querySelector(selector) !== null;
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
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (isIgnored(el)) continue;
    const boxes = [el.getBoundingClientRect()];
    // A range over the contents also covers overflowing text and positioned descendants.
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      if (typeof range.getBoundingClientRect === 'function') boxes.push(range.getBoundingClientRect());
    } catch { /* detached or unsupported */ }
    const visible = boxes.filter((b) => b && b.width > 0 && b.height > 0);
    if (!visible.length) continue;
    const left = Math.min(...visible.map((b) => b.left));
    const top = Math.min(...visible.map((b) => b.top));
    const right = Math.max(...visible.map((b) => b.right));
    const bottom = Math.max(...visible.map((b) => b.bottom));
    const x = Math.floor(left + sx);
    const y = Math.floor(top + sy);
    rects.push({ x, y, width: Math.ceil(right + sx) - x, height: Math.ceil(bottom + sy) - y });
  }
  return rects;
}
