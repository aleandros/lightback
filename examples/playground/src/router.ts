import { useSyncExternalStore } from 'react';
import { isDemo } from './mode';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener('popstate', notify);
window.addEventListener('hashchange', notify);

const currentPath = () => isDemo ? (location.hash.slice(1) || '/') : location.pathname;
export const hrefFor = (path: string) => isDemo ? `${import.meta.env.BASE_URL}#${path}` : path;

export function navigate(path: string) {
  if (currentPath() === path) return;
  history.pushState({}, '', hrefFor(path));
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentPath,
  );
}
