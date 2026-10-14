import { render } from 'svelte/server';
import { writable } from 'svelte/store';
import App from './App.svelte';
export function renderApp(client) {
  return render(App, { props: { client, context: writable({ route: 'initial' }), widget: true } }).body;
}
