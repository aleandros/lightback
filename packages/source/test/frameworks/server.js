import { createLightback } from '@lightback/core';
import { renderApp } from './framework.js';
export async function render() {
  const before = console.log;
  const client = createLightback({ persistence: false });
  try {
    const html = await renderApp(client);
    if (console.log !== before) throw new Error('SSR patched console');
    if (Object.keys(client.buildPayload({text:''}).context).length) throw new Error('SSR applied browser context');
    return html;
  } finally { client.destroy(); }
}
