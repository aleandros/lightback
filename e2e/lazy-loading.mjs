import { launch, W, BASE_URL } from './lib.mjs';
import { readFile } from 'node:fs/promises';

const { page, assert, finish } = await launch('lazy-loading');
const requests = [];
page.on('request', (req) => requests.push(req.url()));
await page.goto(BASE_URL);
await page.locator(W + '[data-ref=pillOpen]').waitFor();
assert(!requests.some((url) => /\/widget\/src\/(ui|styles|screenshot)\.ts/.test(url)), 'React StrictMode mounts only the lightweight trigger');
assert(await page.locator('lightback-widget').count() === 1, 'StrictMode leaves one host');
await page.evaluate(() => console.warn('before lazy UI'));
await page.click(W + '[data-ref=pillOpen]');
await page.locator(W + '[data-ref=panel]').waitFor();
assert(requests.some((url) => /\/widget\/src\/ui\.ts/.test(url)), 'first interaction downloads the UI');
assert(await page.locator(W + '[data-ref=panel]').count() === 1, 'first click opens exactly one editor');
await page.click(W + '[data-action=close]');

// Framework-neutral source path, with an actual failed module download then a retry.
await page.goto(BASE_URL + '/?lazy-retry');
await page.locator(W + '[data-ref=pillOpen]').waitFor();
await page.evaluate(async ({ corePath, widgetPath }) => {
  const { createLightback } = await import(corePath);
  const { mountLazyWidget } = await import(widgetPath);
  // The provider owns a separate host; identify this mount independently of DOM order.
  window.lazyClient = createLightback();
  window.lazyHandle = mountLazyWidget({ client: window.lazyClient, hideTrigger: true });
  window.lazyHandle.element.dataset.ref = 'retryWidget';
  // Reproduce the order seen when React mounts after this fixture on a slower runner.
  document.body.prepend(window.lazyHandle.element);
}, { corePath: '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname, widgetPath: '/@fs' + new URL('../packages/widget/src/lazy.ts', import.meta.url).pathname });
let fail = true;
await page.route('**/widget/src/ui.ts*', (route) => fail ? route.abort() : route.continue());
const failed = await page.evaluate(() => window.lazyHandle.open().then(() => false, () => true));
assert(failed, 'failed module download rejects to host API');
fail = false;
await page.evaluate(() => window.lazyHandle.startPicking());
assert(await page.locator('lightback-widget[data-ref=retryWidget] >> [data-ref=count]').textContent() === '0 selected', 'retry enters pick mode without selecting the trigger');
await page.evaluate(() => { window.lazyHandle.destroy(); window.lazyClient.destroy(); });
assert(await page.locator('lightback-widget').count() === 1, 'destroy removes only its own host');
// Test the shipped standalone files, with a real failed download and fresh-URL retry.
await page.route('**/lazy-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><button data-ref="target">Target</button>' }));
await page.goto(BASE_URL + '/lazy-fixture.html');
await page.route('**/vendor/*.js*', async (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  await route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../packages/widget/dist/' + name, import.meta.url)) });
});
await page.addScriptTag({ url: BASE_URL + '/vendor/lightback-lazy.iife.js' });
await page.evaluate(() => {
  window.lazyClient = Lightback.createLightback();
  console.warn('standalone before UI');
  window.lazyHandle = Lightback.mountLazyWidget({ client: window.lazyClient, theme: 'dark', strings: { pillPick: 'Elegir', loadFailed: 'Reintenta' } });
  window.lazyHost = window.lazyHandle.element;
});
assert(await page.locator(W + '[data-ref=panel]').count() === 0, 'standalone script does not mount editor before interaction');
assert(!requests.some((url) => url.includes('/vendor/lightback-ui.js')), 'standalone UI is not downloaded early');
let failStandalone = true;
await page.route('**/vendor/lightback-ui.js*', (route) => failStandalone ? route.abort() : route.fallback());
await page.click(W + '[data-ref=pillPick]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=loadStatus]').textContent === 'Reintenta');
failStandalone = false;
await page.click(W + '[data-ref=pillPick]');
await page.locator(W + '[data-action=cancel-pick]').waitFor();
assert(await page.locator(W + '[data-ref=count]').textContent() === '0 selected', 'standalone retry starts picking once');
assert(await page.evaluate(() => window.lazyHandle.element === window.lazyHost), 'standalone keeps the host identity');
await page.click('[data-ref=target]');
await page.locator(W + '[data-ref=popover]').waitFor();
assert(await page.locator(W + '[data-ref=count]').textContent() === '1 selected', 'first page click selects one element');
assert(await page.evaluate(() => window.lazyClient.buildPayload({ text: '' }).console.some((entry) => entry.message.includes('standalone before UI'))), 'standalone retains console context from before loading');
await page.evaluate(() => { window.lazyHandle.destroy(); window.lazyClient.destroy(); });
await finish();
