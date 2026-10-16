import { composedClosest, composedParent, frameDocument, frameGeometry } from '@lightback/core';

export function pickable(el: Element, ignored: (el: Element) => boolean): boolean {
  if (!el.isConnected || el === el.ownerDocument.body || el === el.ownerDocument.documentElement || ignored(el)) return false;
  if (composedClosest(el, '[hidden],[inert],[aria-hidden="true"]')) return false;
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.visibility === 'visible' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}

function children(el: Element): Element[] {
  if (el.localName === 'slot') {
    const assigned = (el as HTMLSlotElement).assignedElements({ flatten: true });
    if (assigned.length) return assigned;
  }
  if (el.shadowRoot) return Array.from(el.shadowRoot.children);
  const doc = frameDocument(el);
  if (doc && frameGeometry(el)) return doc.body ? Array.from(doc.body.children) : [];
  return Array.from(el.children);
}

/** Traverse rendered contexts without focusing or activating host elements. */
export function keyboardTarget(current: Element | null, key: string, ignored: (el: Element) => boolean): Element | null {
  const targets: Element[] = [];
  const stack = Array.from(document.body.children).reverse();
  const seen = new Set<Element>();
  while (stack.length) {
    const el = stack.pop()!;
    if (seen.has(el)) continue;
    seen.add(el);
    if (ignored(el) || el.matches('[hidden],[inert],[aria-hidden="true"],script,style,template') || el.ownerDocument.defaultView!.getComputedStyle(el).display === 'none') continue;
    if (pickable(el, ignored)) targets.push(el);
    stack.push(...children(el).reverse());
  }
  const parent = (el: Element): Element | null => {
    for (let p = composedParent(el); p; p = composedParent(p)) if (targets.includes(p)) return p;
    return null;
  };
  const index = current ? targets.indexOf(current) : -1;
  if (index < 0) return key === 'ArrowUp' || key === 'ArrowLeft' ? null : targets[0] ?? null;
  if (key === 'ArrowLeft') return parent(current!);
  if (key === 'ArrowRight') return targets.find(el => parent(el) === current) ?? null;
  return targets[index + (key === 'ArrowUp' ? -1 : 1)] ?? null;
}
