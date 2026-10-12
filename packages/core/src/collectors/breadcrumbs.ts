import type { Breadcrumb } from '../types';
import { RingBuffer } from '../ring';
import { shortSelector } from '../inspect';

export function installBreadcrumbs(buffer: RingBuffer<Breadcrumb>, isIgnored: (el: Element) => boolean): () => void {
  if (typeof window === 'undefined') return () => {};

  const onClick = (e: MouseEvent) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el || isIgnored(el)) return;
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    buffer.push({
      t: Date.now(),
      type: 'click',
      message: `${shortSelector(el)}${text ? ` "${text}"` : ''}`,
    });
  };

  const onInput = (e: Event) => {
    const el = e.target instanceof Element ? e.target : null;
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
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;
  history.pushState = function (...args) {
    originalPush.apply(this, args);
    recordNavigation('pushState');
  };
  history.replaceState = function (...args) {
    originalReplace.apply(this, args);
    recordNavigation('replaceState');
  };
  const onPop = () => recordNavigation('popstate');
  const onHash = () => recordNavigation('hashchange');

  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onInput, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onHash);

  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onInput, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onHash);
    history.pushState = originalPush;
    history.replaceState = originalReplace;
  };
}
