import { createApp, createSSRApp, h, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import App from './App.vue';
export function start(client, hydrate, widget, target = '#app') {
  const context = ref({ route: 'initial' });
  const app = (hydrate ? createSSRApp : createApp)({ render: () => h(App, { client, context: context.value, widget }) });
  app.mount(target);
  return { update: (value) => { context.value = value; }, unmount: () => app.unmount() };
}
export function renderApp(client) {
  return renderToString(createSSRApp({ render: () => h(App, { client, context: { route: 'initial' }, widget: true }) }));
}
