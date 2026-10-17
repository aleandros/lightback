import type { Rect } from './types';

/** Same-origin access only; sandboxed and cross-origin frames remain opaque. */
export function frameDocument(el: Element): Document | null {
  if (el.localName !== 'iframe') return null;
  const frame = el as HTMLIFrameElement;
  if (frame.hasAttribute('sandbox') && !frame.sandbox.contains('allow-same-origin')) return null;
  try {
    // WebKit reports denied access even when the platform getter is guarded.
    // Avoid touching known foreign URLs; srcdoc/about:blank inherit the embedding origin.
    const src = frame.getAttribute('src');
    if (!frame.hasAttribute('srcdoc') && src) {
      const url = new URL(src, frame.ownerDocument.baseURI);
      if (url.protocol !== 'about:' && url.origin !== window.origin) return null;
    }
    return frame.contentDocument;
  } catch { return null; }
}

export function ownerFrame(doc: Document): Element | null {
  try { return doc.defaultView?.frameElement ?? null; } catch { return null; }
}

/** Rendered ancestry crosses slots, open roots and accessible frame documents. */
export function composedParent(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode() as ShadowRoot;
  return root.host ?? (el.ownerDocument === document ? null : ownerFrame(el.ownerDocument));
}

export function composedContains(parent: Element, child: Element): boolean {
  for (let el: Element | null = child; el; el = composedParent(el)) if (el === parent) return true;
  return false;
}

export function composedClosest(el: Element, selector: string): Element | null {
  for (let cur: Element | null = el; cur; cur = composedParent(cur)) if (cur.matches(selector)) return cur;
  return null;
}

/** Axis-aligned positive CSS scaling is supported. Other transforms are an opaque frame boundary. */
export function frameGeometry(frame: Element): { x: number; y: number; sx: number; sy: number; width: number; height: number } | null {
  for (let el: Element | null = frame; el; el = composedParent(el)) {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (!style) return null;
    if ((style.rotate && style.rotate !== 'none') || (style.perspective && style.perspective !== 'none')) return null;
    if (style.scale && style.scale !== 'none' && style.scale.split(/\s+/).some(n => !(parseFloat(n) > 0))) return null;
    if (style.transform !== 'none' && style.transform) {
      const m = /^matrix\(([^)]+)\)$/.exec(style.transform)?.[1]?.split(',').map(Number);
      if (!m || m.length !== 6 || !(m[0]! > 0) || !(m[3]! > 0) || m[1] !== 0 || m[2] !== 0) return null;
    }
  }
  const el = frame as HTMLElement;
  const r = el.getBoundingClientRect();
  if (!el.offsetWidth || !el.offsetHeight) return null;
  const sx = r.width / el.offsetWidth, sy = r.height / el.offsetHeight;
  if (!(sx > 0 && sy > 0)) return null;
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  const left = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
  const right = parseFloat(style.paddingRight) || 0, bottom = parseFloat(style.paddingBottom) || 0;
  return { x: r.x + (el.clientLeft + left) * sx, y: r.y + (el.clientTop + top) * sy, sx, sy, width: (el.clientWidth - left - right) * sx, height: (el.clientHeight - top - bottom) * sy };
}

/** Map local viewport coordinates into the widget document's viewport. Frame scroll is already in DOM rects. */
export function toTopRect(rect: Rect, doc: Document, clip = false): Rect {
  let r = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  for (let frame = doc === document ? null : ownerFrame(doc); frame; frame = ownerFrame(doc)) {
    const g = frameGeometry(frame);
    if (!g) return toTopRect(frame.getBoundingClientRect(), frame.ownerDocument, clip);
    r = { x: g.x + r.x * g.sx, y: g.y + r.y * g.sy, width: r.width * g.sx, height: r.height * g.sy };
    if (clip) {
      const right = Math.min(r.x + r.width, g.x + g.width), bottom = Math.min(r.y + r.height, g.y + g.height);
      r.x = Math.max(r.x, g.x); r.y = Math.max(r.y, g.y);
      r.width = Math.max(0, right - r.x); r.height = Math.max(0, bottom - r.y);
    }
    doc = frame.ownerDocument;
    if (typeof document !== 'undefined' && doc === document) break;
  }
  return r;
}

export function elementRect(el: Element): Rect {
  return toTopRect(el.getBoundingClientRect(), el.ownerDocument, true);
}

/** Hit-test recursively without looking behind overlays or entering inaccessible contexts. */
export function deepElementFromPoint(x: number, y: number, root: Document | ShadowRoot = document): Element | null {
  let el = root.elementFromPoint?.(x, y) ?? null;
  if (!el) return null;
  const seen = new Set<Element>();
  while (el && !seen.has(el)) {
    seen.add(el);
    if (el.shadowRoot) {
      const inner: Element | null = el.shadowRoot.elementFromPoint?.(x, y) ?? null;
      if (inner && inner !== el) { el = inner; continue; }
    }
    const doc = frameDocument(el), g = doc && frameGeometry(el);
    if (doc && g && x >= g.x && y >= g.y && x < g.x + g.width && y < g.y + g.height) {
      return deepElementFromPoint((x - g.x) / g.sx, (y - g.y) / g.sy, doc) ?? el;
    }
    break;
  }
  return el;
}

/** DOM roots, including open shadow trees and same-origin documents. Does not pierce ignored hosts. */
export function domRoots(root: Document | ShadowRoot | Element, skip: (el: Element) => boolean = () => false): Array<Document | ShadowRoot | Element> {
  const roots: Array<Document | ShadowRoot | Element> = [root];
  for (let i = 0; i < roots.length; i++) {
    const current = roots[i]!;
    const visit = (el: Element) => {
      // Only boundary hosts need the composed ignore walk; ordinary nodes cannot add roots.
      if (!el.shadowRoot && el.localName !== 'iframe') return;
      if (skip(el)) return;
      if (el.shadowRoot) roots.push(el.shadowRoot);
      const doc = frameDocument(el);
      if (doc) roots.push(doc);
    };
    if (current.nodeType === 1) visit(current as Element);
    for (const el of Array.from(current.querySelectorAll('*'))) visit(el);
  }
  return roots;
}

/** Observe new/navigated frames and roots, and dispose detached listeners. attachShadow itself has no DOM mutation. */
export function observeDomRoots(bind: (root: Document | ShadowRoot) => () => void, skip: (el: Element) => boolean): () => void {
  const active = new Map<Document | ShadowRoot, () => void>();
  let stopped = false, queued = false;
  const refresh = () => {
    queued = false;
    if (stopped) return;
    const roots = new Set(domRoots(document, skip) as Array<Document | ShadowRoot>);
    for (const [root, undo] of active) if (!roots.has(root)) { undo(); active.delete(root); }
    for (const root of roots) if (!active.has(root)) {
      const undo = bind(root);
      const observer = new window.MutationObserver(records => {
        for (const record of records) {
          const target = record.target.nodeType === 1 ? record.target as Element : (record.target as ShadowRoot).host;
          if (target && skip(target)) continue;
          // Ordinary text/list updates need no whole-page discovery. Inspect only newly added subtrees.
          for (const node of Array.from(record.addedNodes)) if (node.nodeType === 1 && !skip(node as Element)
            && domRoots(node as Element, skip).length > 1) { schedule(); return; }
          if (record.removedNodes.length && Array.from(active.keys()).some(context => {
            const host = (context as ShadowRoot).host ?? ownerFrame(context as Document);
            return host && !host.isConnected;
          })) { schedule(); return; }
        }
      });
      observer.observe(root, { childList: true, subtree: true });
      root.addEventListener('load', schedule, true);
      active.set(root, () => { undo(); observer.disconnect(); root.removeEventListener('load', schedule, true); });
    }
  };
  const schedule = () => { if (!queued && !stopped) { queued = true; queueMicrotask(refresh); } };
  refresh();
  const timer = setInterval(refresh, 1000);
  return () => { stopped = true; clearInterval(timer); for (const undo of active.values()) undo(); active.clear(); };
}
