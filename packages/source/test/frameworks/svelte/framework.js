import { hydrate, mount, unmount } from 'svelte';
import { writable } from 'svelte/store';
import App from './App.svelte';
export function start(client, hydrating, widget, target = '#app') {
  const context = writable({ route: 'initial' });
  const app = (hydrating ? hydrate : mount)(App, { target: document.querySelector(target), props: { client, context, widget } });
  return { update: (value) => context.set(value), unmount: () => unmount(app) };
}
