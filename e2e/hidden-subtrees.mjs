// Responsive hidden trees must neither exhaust the budget nor shift screenshot/crop pixels.
import { launch, W, BASE_URL } from './lib.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const { page, assert, received, reset, finish, OUT } = await launch('hidden-subtrees');
page.setDefaultTimeout(15000);
const capturePath = '/@fs' + new URL('../packages/widget/src/capture.ts', import.meta.url).pathname;
const rendererPath = '/@fs' + new URL('../examples/playground/node_modules/modern-screenshot/dist/index.mjs', import.meta.url).pathname;
const corePath = '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname;
const widgetPath = '/@fs' + new URL('../packages/widget/src/index.ts', import.meta.url).pathname;
if (process.env.BENCHMARK) {
  const ts = await import('typescript');
  const source = execFileSync('git', ['show', 'd8d4201:packages/widget/src/capture.ts'], { encoding: 'utf8' });
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  // Serve the released implementation without creating source files that trigger Vite's live reload.
  await page.route('**/legacy-capture.js', route => route.fulfill({ contentType: 'text/javascript', body: outputText }));
}
await reset();
await page.goto(BASE_URL + '/responsive-table');
await page.locator('[data-ref=desktop-table]').waitFor();
const costs = await page.evaluate(async capturePath => {
  const { captureCost, domCapturer } = await import(capturePath);
  const root = document.documentElement;
  const viewport = { x: 0, y: 0, width: root.clientWidth, height: root.clientHeight };
  const whole = { x: 0, y: 0, width: root.scrollWidth, height: root.scrollHeight };
  const list = document.querySelector('[data-ref=mobile-cards]');
  const withHidden = [captureCost(viewport), captureCost(whole)];
  const next = list.nextSibling, parent = list.parentNode;
  list.remove();
  const detached = [captureCost(viewport), captureCost(whole)];
  parent.insertBefore(list, next);
  // For both modes, the accepted clone tree and estimated cost must agree.
  const cloned = [];
  for (const area of [viewport, whole]) await domCapturer(async (node, options) => {
    let count = 1;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => options.filter(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    while (walker.nextNode()) count++;
    cloned.push(count);
    return null;
  })({ area });
  return { withHidden, detached, cloned, total: document.querySelectorAll('*').length };
}, capturePath);
assert(costs.total > 8000, `fixture exceeds raw budget (${costs.total} elements)`);
assert(costs.withHidden.every((n, i) => n === costs.detached[i] && n === costs.cloned[i]), `hidden trees cost nothing in either mode (${JSON.stringify(costs)})`);
assert(costs.withHidden[0] < 8000, 'viewport automatic capture fits the unchanged budget');

// Optional benchmark against the last released implementation. No production DOM is mutated.
if (process.env.BENCHMARK) {
  const metrics = await page.evaluate(async ({ capturePath, legacyPath }) => {
    const current = await import(capturePath), legacy = await import(legacyPath);
    // Preload once so timings cover filter construction + rendering, not module downloads.
    const { screenshot } = await import('/src/lightback.ts');
    const root = document.documentElement;
    const area = { x: 0, y: 0, width: root.clientWidth, height: root.clientHeight };
    await screenshot({ area });
    const renderer = await import('/node_modules/.vite/deps/modern-screenshot.js');
    const results = [];
    for (const [name, implementation] of [['before', legacy], ['after', current], ['after', current], ['before', legacy], ['before', legacy], ['after', current]]) {
      const cost = implementation.captureCost(area);
      const start = performance.now();
      const blob = await implementation.domCapturer((node, options) => renderer.domToBlob(node, { ...options, type: 'image/png', scale: 1 }))({ area });
      results.push({ name, cost, ms: Math.round(performance.now() - start), bytes: blob.size });
    }
    return { viewport: area, userAgent: navigator.userAgent, results };
  }, { capturePath, legacyPath: BASE_URL + '/legacy-capture.js' });
  fs.writeFileSync(OUT + 'benchmark.json', JSON.stringify(metrics, null, 2));
  console.log('BENCHMARK', JSON.stringify(metrics));
}

await page.click(W + '[data-action=pick]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]')?.src.startsWith('blob:'), null, { timeout: 20000 });
await page.locator('[data-testid=capture-pixel]').click();
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === 1);
await page.click(W + '[data-action=done]');
await page.click(W + '[data-action=send]');
await page.waitForSelector(W + '[data-ref=toast]:not([hidden])');
const [sub] = await received();
assert(sub.payload.attachments.length === 2, 'automatic screenshot and crop are sent');
const pixels = await page.evaluate(async sub => {
  const selection = sub.payload.selections[0];
  const result = [];
  for (const name of ['screenshot.png', selection.crop]) {
    const attachment = sub.payload.attachments.find(a => a.name === name);
    const image = new Image(); image.src = sub.files[name]; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const r = selection.docRect, a = attachment.area;
    result.push([...ctx.getImageData(Math.floor((r.x + r.width / 2 - a.x) * image.width / a.width), Math.floor((r.y + r.height / 2 - a.y) * image.height / a.height), 1, 1).data]);
  }
  return result;
}, sub);
assert(pixels.every(p => p[0] === 20 && p[1] === 180 && p[2] === 90 && p[3] === 255), `screenshot and crop land on exact green pixels (${JSON.stringify(pixels)})`);

// Isolated real-browser geometry, SVG resources, and send confirmation with localized labels.
await page.route('**/hidden-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
<select id="native-select" style="display:block;margin-top:50px;width:240px;height:60px;font:24px sans-serif;color:rgb(200,0,0);background:white;appearance:none"><optgroup id="native-group" label="Status"><option id="native-option" selected hidden>VISIBLE STATUS</option><option>Another status</option></optgroup></select>
<div style="display:contents" id="contents"><span id="child">visible</span></div>
<details><summary id="summary">Closed details</summary><div id="closed">Not shown</div></details>
<div hidden id="hidden"><span>Hidden</span></div><span id="empty"></span><br id="br"><wbr id="wbr">
<svg width="100" height="50" id="svg"><defs id="defs"><linearGradient id="gradient"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect id="rect" width="100" height="50" fill="url(#gradient)"/></svg>
<div style="position:absolute;top:2000px" id="offscreen"><div style="position:fixed;top:0;left:500px" id="fixed">Fixed</div></div>
</body></html>` }));
for (const outcome of ['budget', 'failure', 'null']) {
  await page.goto(BASE_URL + '/hidden-fixture.html');
  const geometry = await page.evaluate(async ({ capturePath, corePath, widgetPath, rendererPath, outcome }) => {
    const { domCapturer, captureCost } = await import(capturePath);
    const { createLightback } = await import(corePath), { mountWidget } = await import(widgetPath);
    const root = document.documentElement;
    const area = { x: 0, y: 0, width: root.clientWidth, height: root.clientHeight };
    const kept = {};
    await domCapturer(async (_, options) => {
      for (const id of ['native-select', 'native-group', 'native-option', 'contents', 'child', 'summary', 'closed', 'hidden', 'empty', 'br', 'wbr', 'svg', 'defs', 'gradient', 'rect', 'offscreen', 'fixed']) kept[id] = options.filter(document.getElementById(id));
      return null;
    })({ area });
    const selectPixels = [];
    if (outcome === 'budget') {
      const { domToBlob } = await import(rendererPath);
      for (const requested of [area, { x: 0, y: 0, width: root.scrollWidth, height: root.scrollHeight }]) {
        const blob = await domCapturer((node, options) => domToBlob(node, { ...options, scale: 1 }))({ area: requested });
        const image = new Image(); const url = URL.createObjectURL(blob); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); URL.revokeObjectURL(url);
        const r = document.getElementById('native-select').getBoundingClientRect();
        const pixels = ctx.getImageData(r.x, r.y, r.width, r.height).data;
        let red = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 120 && pixels[i + 1] < 90 && pixels[i + 2] < 90) red++;
        selectPixels.push(red);
      }
    }
    window.deliveries = []; window.captureCalls = 0;
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
    canvas.getContext('2d').fillRect(0, 0, 100, 100);
    const blob = await new Promise(r => canvas.toBlob(r));
    window.client = createLightback({ persistence: false, send: async p => window.deliveries.push(p) });
    window.widget = mountWidget({ client: window.client, screenshotMaxElements: outcome === 'budget' ? 1 : 8000, sendDelay: 10,
      screenshot: async () => { window.captureCalls++; if (window.captureCalls === 1 && outcome === 'failure') throw Error('test failure'); if (window.captureCalls === 1 && outcome === 'null') return null; return blob; },
      strings: { missingScreenshot: 'Falta la imagen', addScreenshot: 'Añadir imagen', sendAnyway: 'Enviar sin imagen' },
    });
    return { kept, cost: captureCost(area), selectPixels };
  }, { capturePath, corePath, widgetPath, rendererPath, outcome });
  assert(Object.entries(geometry.kept).every(([id, kept]) => kept === !['hidden', 'closed'].includes(id)), `geometry retained (${JSON.stringify(geometry)})`);
  if (outcome === 'budget') assert(geometry.selectPixels.length === 2 && geometry.selectPixels.every(n => n > 50), `native dropdown label appears in both modes (${geometry.selectPixels})`);
  await page.click(W + '[data-action=pick]');
  await page.locator(W + '[data-ref=shotBtn][data-attention=true]').waitFor({ state: 'attached' });
  await page.locator('#child').click();
  await page.click(W + '[data-action=pop-send]');
  await page.locator(W + '[data-ref=missingShot]').waitFor();
  assert(await page.locator(W + '[data-ref=missingShot]').getAttribute('aria-label') === 'Falta la imagen', 'confirmation is localized');
  assert(await page.evaluate(() => window.deliveries.length) === 0, `${outcome}: delayed send waits for a choice`);
  if (outcome === 'budget') {
    await page.screenshot({ path: OUT + 'missing-screenshot.png' });
    await page.click(W + '[data-action=send-anyway]');
    await page.waitForFunction(() => window.deliveries.length === 1);
    assert(await page.evaluate(() => window.deliveries[0].attachments.length) === 0, 'send anyway sends without images');
  } else {
    await page.click(W + '[data-action=shot-add]');
    await page.locator(W + '[data-ref=shot]').waitFor();
    assert(await page.locator(W + '[data-ref=panel]').isVisible() && await page.evaluate(() => window.deliveries.length) === 0, 'add screenshot captures and stays in editor');
    assert(await page.locator(W + '[data-ref=shotBtn]').getAttribute('data-attention') === null, 'successful capture clears attention');
    await page.click(W + '[data-action=send]');
    await page.waitForFunction(() => window.deliveries.length === 1);
  }
  await page.evaluate(() => { window.widget.destroy(); window.client.destroy(); });
}
await finish();
