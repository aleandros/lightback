import type { ElementSelection, Rect } from './types';
import { describeElement, summarizeElement, toDocRect, viewportRect } from './inspect';

export interface RegionOptions {
  /** Topmost element at a viewport point. Defaults to `document.elementFromPoint`. */
  hitTest?: (x: number, y: number) => Element | null;
  /** Elements to skip (the widget itself). */
  isIgnored?: (el: Element) => boolean;
  /** Max children listed in the region. */
  maxChildren?: number;
}

const MIN_STEP = 6;
const MAX_POINTS_PER_AXIS = 40;
const CONTAIN_TOLERANCE = 2;

/**
 * Describe a dragged rectangle. Uses the browser's hit testing on a grid of sample points, so only
 * elements that are actually visible and on top (a modal, not what sits behind its backdrop) are considered.
 * The container is the lowest common ancestor of everything hit; the children are the largest visible
 * elements fully inside the rectangle.
 */
export function describeRegion(rect: Rect, opts: RegionOptions = {}): ElementSelection | null {
  const hitTest = opts.hitTest ?? ((x, y) => document.elementFromPoint(x, y));
  const isIgnored = opts.isIgnored ?? (() => false);
  const maxChildren = opts.maxChildren ?? 25;

  const allHits = sampleHits(rect, hitTest, isIgnored);
  if (allHits.length === 0) return null;

  // A hit that contains other hits is a surface the drag spilled onto (a modal backdrop, a card's
  // padding). Drop those so the container is the thing the user framed, not what sits around it.
  const leaves = allHits.filter((h) => !allHits.some((o) => o !== h && h.contains(o)));
  const hits = leaves.length ? leaves : allHits;

  const container = commonAncestor(hits) ?? document.body;
  const children = containedChildren(hits, rect, container).slice(0, maxChildren);

  const base = describeElement(container);
  return {
    ...base,
    kind: 'region',
    region: {
      rect,
      docRect: toDocRect(rect),
      children: children.map(summarizeElement),
    },
  };
}

function sampleHits(rect: Rect, hitTest: (x: number, y: number) => Element | null, isIgnored: (el: Element) => boolean): Element[] {
  const stepX = Math.max(MIN_STEP, rect.width / MAX_POINTS_PER_AXIS);
  const stepY = Math.max(MIN_STEP, rect.height / MAX_POINTS_PER_AXIS);
  const seen = new Set<Element>();
  const doc = typeof document !== 'undefined' ? document : null;
  for (let y = rect.y + stepY / 2; y < rect.y + rect.height; y += stepY) {
    for (let x = rect.x + stepX / 2; x < rect.x + rect.width; x += stepX) {
      const el = hitTest(Math.round(x), Math.round(y));
      if (!el || seen.has(el)) continue;
      if (doc && (el === doc.documentElement || el === doc.body)) continue;
      if (isIgnored(el)) continue;
      seen.add(el);
    }
  }
  return Array.from(seen);
}

export function commonAncestor(els: Element[]): Element | null {
  if (els.length === 0) return null;
  let candidate: Element | null = els[0]!;
  for (const el of els.slice(1)) {
    while (candidate && !candidate.contains(el)) candidate = candidate.parentElement;
    if (!candidate) return null;
  }
  return candidate;
}

function isContained(inner: Rect, outer: Rect): boolean {
  const t = CONTAIN_TOLERANCE;
  return (
    inner.width > 0 &&
    inner.height > 0 &&
    inner.x >= outer.x - t &&
    inner.y >= outer.y - t &&
    inner.x + inner.width <= outer.x + outer.width + t &&
    inner.y + inner.height <= outer.y + outer.height + t
  );
}

/**
 * For each hit, climb to the highest ancestor (below the container) that is still fully inside the
 * rectangle. Hits that are not contained at all (a big element partially covered) are kept as-is so
 * the region still says what it touches. Nested results are collapsed into their ancestors.
 */
function containedChildren(hits: Element[], rect: Rect, container: Element): Element[] {
  const picked = new Set<Element>();
  for (const hit of hits) {
    let cur: Element = hit;
    while (cur.parentElement && cur.parentElement !== container && isContained(viewportRect(cur.parentElement), rect)) {
      cur = cur.parentElement;
    }
    picked.add(cur);
  }
  const list = Array.from(picked).filter((el) => el !== container);
  const collapsed = list.filter((el) => !list.some((other) => other !== el && other.contains(el)));
  // Document order, so the list reads top to bottom.
  return collapsed.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}
