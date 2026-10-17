import { observeDomRoots } from '../dom';
import type { Breadcrumb } from '../types';
import { RingBuffer } from '../ring';
import { elementText, shortSelector } from '../inspect';
import { DEFAULT_SENSITIVE } from '../sensitive';
import { patchMethod } from './patch';

export function installBreadcrumbs(buffer: RingBuffer<Breadcrumb>, isIgnored: (el: Element) => boolean, sensitive = DEFAULT_SENSITIVE): () => void {
  if (typeof window === 'undefined') return () => {};

  const seen = new WeakSet<Event>();
  const target = (e: Event): Element | null => {
    if (seen.has(e)) return null;
    seen.add(e);
    return e.composedPath().find(node => (node as Node).nodeType === 1) as Element | undefined ?? null;
  };
  const onClick = (e: MouseEvent) => {
    const el = target(e);
    if (!el || isIgnored(el)) return;
    // Sensitive targets yield no text; their sensitive descendants are dropped from ancestors' text.
    const text = elementText(el, 60, sensitive);
    buffer.push({
      t: Date.now(),
      type: 'click',
      message: `${shortSelector(el)}${text ? ` "${text}"` : ''}`,
    });
  };

  const onInput = (e: Event) => {
    const el = target(e);
    if (!el || isIgnored(el)) return;
    // Never record values; only that an input changed.
    buffer.push({ t: Date.now(), type: 'input', message: shortSelector(el) });
  };

  const onVisibility = () => {
    buffer.push({ t: Date.now(), type: 'visibility', message: document.visibilityState });
  };

  let lastUrl = location.href;
  const recordNavigation = (how: string) => {
    if (location.href === lastUrl) return;
    buffer.push({ t: Date.now(), type: 'navigation', message: `${how}: ${lastUrl} -> ${location.href}` });
    lastUrl = location.href;
  };
  const undoPush = patchMethod(history, 'pushState', (original) => function (this: History, ...args) {
    original.apply(this, args);
    recordNavigation('pushState');
  });
  const undoReplace = patchMethod(history, 'replaceState', (original) => function (this: History, ...args) {
    original.apply(this, args);
    recordNavigation('replaceState');
  });
  const onPop = () => recordNavigation('popstate');
  const onHash = () => recordNavigation('hashchange');

  const stopRoots = observeDomRoots(root => {
    root.addEventListener('click', onClick as EventListener, true);
    root.addEventListener('change', onInput, true);
    return () => {
      root.removeEventListener('click', onClick as EventListener, true);
      root.removeEventListener('change', onInput, true);
    };
  }, isIgnored);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onHash);

  return () => {
    stopRoots();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onHash);
    undoPush();
    undoReplace();
  };
}
