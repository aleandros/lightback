/** Light-DOM traversal without changing focus or tabindex on the host page. */
export function pickable(el: Element, ignored: (el: Element) => boolean): boolean {
  if (!el.isConnected || el === document.body || el === document.documentElement || ignored(el)) return false;
  if (el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.visibility === 'visible' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}

export function keyboardTarget(current: Element | null, key: string, ignored: (el: Element) => boolean): Element | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(el) {
      const element = el as Element;
      if (ignored(element) || element.matches('[hidden],[inert],[aria-hidden="true"],script,style,template') || getComputedStyle(element).display === 'none') return NodeFilter.FILTER_REJECT;
      return pickable(element, ignored) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  if (current && pickable(current, ignored)) walker.currentNode = current;
  const next = (key === 'ArrowLeft' ? walker.parentNode()
    : key === 'ArrowRight' ? walker.firstChild()
    : key === 'ArrowUp' ? walker.previousNode() : walker.nextNode()) as Element | null;
  // TreeWalker may return its root even though the filter excludes body.
  return next && pickable(next, ignored) ? next : null;
}
