// Sensitive elements and reporter masks: data withheld and pixels masked through picks, regions, previews,
// persistence, reload and send. The fixture capturer paints the whole page red, so any red pixel inside a
// sensitive or hidden rect is a leak.
import { launch, W, BASE_URL } from './lib.mjs';
const { page, OUT, assert, finish } = await launch('privacy-masking');
const corePath = '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname;
const widgetPath = '/@fs' + new URL('../packages/widget/src/lazy.ts', import.meta.url).pathname;
const fixture = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<section id="account" style="position:absolute;left:40px;top:40px;width:420px;height:170px">
  <h2 style="margin:0 0 8px">Account</h2>
  <p id="ssn" data-lightback-sensitive title="secret-title" style="margin:0;width:300px;height:40px">SSN secret-ssn-123 <b id="nested">secret-nested</b></p>
  <div class="billing"><span id="card" style="display:inline-block;width:220px;height:30px">secret-card-4111</span></div>
  <span id="visible">Visible label</span>
</section>
<button id="target" style="position:absolute;left:600px;top:60px;width:160px;height:50px">Report this</button>
<button id="hideme" style="position:absolute;left:600px;top:220px;width:160px;height:50px">Hide me</button>
<div id="dynamic" style="position:absolute;left:40px;top:320px;width:300px;height:40px"></div>
<script type="module">
import { createLightback } from ${JSON.stringify(corePath)};
import { mountLazyWidget } from ${JSON.stringify(widgetPath)};
window.sent = [];
window.client = createLightback({ persistence: { attachments: true }, privacy: { selectors: ['.billing span'] },
 send: async (payload, attachments) => { window.sent.push({ payload, attachments }); } });
window.widget = mountLazyWidget({ client, sendDelay: 0, screenshot: async () => {
 const canvas = document.createElement('canvas');
 canvas.width = document.documentElement.scrollWidth * 2; canvas.height = document.documentElement.scrollHeight * 2;
 const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
 return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
} });
/** RGB at document point (x, y) of an image whose origin is document point (ox, oy), at 2x. */
window.pixel = async (blob, x, y, ox = 0, oy = 0) => {
 const bitmap = await createImageBitmap(blob);
 const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
 const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
 return Array.from(ctx.getImageData(Math.round((x - ox) * 2), Math.round((y - oy) * 2), 1, 1).data.slice(0, 3));
};
window.center = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.x + r.width / 2 + scrollX, r.y + r.height / 2 + scrollY]; };
await client.ready;
window.fixtureReady = true;
</script></body></html>`;
await page.context().route('**/privacy-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
async function load() {
  await page.goto(BASE_URL + '/privacy-fixture.html');
  await page.waitForFunction(() => window.fixtureReady);
}
const RED = '255,0,0';
const MASK = '17,24,39';
const color = (blobExpr, selector, origin = '[0, 0]') => page.evaluate(async ([blobExpr, selector, origin]) => {
  const blob = await new Function(`return (${blobExpr})`)();
  const [x, y] = window.center(selector);
  return (await window.pixel(blob, x, y, ...origin)).join(',');
}, [blobExpr, selector, JSON.parse(origin)]);

await load();
await page.click('#ssn'); // ordinary click: a breadcrumb without the text
// Dynamic content: marked sensitive after the client and widget started.
const addLate = () => {
  const late = document.createElement('span');
  late.id = 'late'; late.setAttribute('data-lightback-sensitive', ''); late.textContent = 'secret-dynamic';
  late.style.cssText = 'display:inline-block;width:200px;height:30px';
  document.getElementById('dynamic').appendChild(late);
};
await page.evaluate(addLate);

// ---- pick: direct, nested, configured selector, region over the whole account card, and an ordinary element
await page.click(W + '[data-ref=pillPick]');
await page.locator(W + '[data-action=done]').waitFor();
// Nested first: a pin covers its element, so the parent is clicked beside the nested pin.
for (const selector of ['#nested', '#ssn', '#card', '#late', '#target']) {
  await page.click(selector, selector === '#ssn' ? { position: { x: 4, y: 4 } } : undefined);
  await page.click(W + '[data-action=pop-more]');
}
await page.mouse.move(30, 30);
await page.mouse.down();
await page.mouse.move(60, 60);
await page.mouse.move(470, 220, { steps: 6 });
await page.mouse.up();
await page.click(W + '[data-action=pop-more]');
// ---- reporter mask: click the element in mask mode
await page.click(W + '[data-action=mask-mode]');
assert(await page.getAttribute(W + '[data-ref=maskMode]', 'aria-pressed') === 'true', 'mask mode toggles on');
await page.click('#hideme');
assert(await page.locator(W + '.lb-mask').count() === 1, 'hidden area is drawn on the page while picking');
assert(await page.locator(W + '.lb-pin').count() === 6, 'a click in mask mode does not add a selection');
await page.screenshot({ path: OUT + '1-picking.png' });
await page.click(W + '[data-action=done]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === 6);
await page.screenshot({ path: OUT + '2-panel.png' });

const cards = await page.locator(W + '[data-ref=selections]').textContent();
assert(!/secret/.test(cards), 'selection cards show no sensitive text');
assert(await page.locator(W + '[data-ref=sensitive]').count() === 4, 'direct, nested, selector and dynamic picks are marked as withheld');
await page.click(W + '[data-ref=review] summary');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=preview]').textContent.length > 0);
const prompt = await page.locator(W + '[data-ref=preview]').textContent();
assert(!/secret/.test(prompt) && prompt.includes('Sensitive: content withheld') && prompt.includes('Screenshot masks'), 'prompt preview withholds content and explains masks');

// ---- previews: the panel's screenshot image is already masked
const preview = `fetch(document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]').src).then((r) => r.blob())`;
for (const selector of ['#ssn', '#card', '#late', '#hideme']) assert(await color(preview, selector) === MASK, `preview masks ${selector}`);
assert(await color(preview, '#target') === RED, 'preview keeps ordinary pixels');

// ---- persistence: the stored record has no secrets and only masked pixels
await page.evaluate(() => client.flushPersistence());
const stored = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => { const r = indexedDB.open('lightback-recovery', 1); r.onsuccess = () => resolve(r.result); r.onerror = reject; });
  const record = await new Promise((resolve) => {
    const request = db.transaction('sessions').objectStore('sessions').get(sessionStorage.getItem('lightback:session:default'));
    request.onsuccess = () => resolve(request.result);
  });
  db.close();
  const shot = record.state.draft.attachments.find((a) => a.name === 'screenshot.png');
  window.storedShot = new Blob([shot.data], { type: 'image/png' });
  return { json: JSON.stringify(record, (k, v) => (v instanceof ArrayBuffer ? `[${v.byteLength} bytes]` : v)), names: record.state.draft.attachments.map((a) => a.name) };
});
assert(!/secret/.test(stored.json), 'recovery record contains no sensitive text or attributes');
assert(stored.names.length === 7, `screenshot and six crops persisted (${stored.names.join(', ')})`);
assert(await color('window.storedShot', '#ssn') === MASK && await color('window.storedShot', '#hideme') === MASK, 'persisted screenshot bytes are masked');

// ---- reload: masks and sanitized draft return; a fresh capture still applies the reporter mask
await load();
await page.evaluate(addLate);
await page.click(W + '[data-ref=pillOpen]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === 6);
assert(await page.evaluate(() => client.getDraft().masks.filter((m) => m.reason === 'reporter').length) === 1, 'reporter mask restored');
await page.click(W + '[data-action=shot]'); // retake after reload
await page.waitForFunction(() => window.client.getDraft()?.attachments.some((a) => a.name === 'screenshot.png' && a.blob !== window.storedShot));
await page.waitForTimeout(200);
assert(await color(preview, '#hideme') === MASK, 'retaken screenshot reapplies the restored reporter mask');
await page.fill(W + '[data-ref=text]', 'Account card looks wrong');
await page.click(W + '[data-action=send]');
await page.waitForFunction(() => window.sent.length === 1);

// ---- send: payload, prompt and every image
const json = await page.evaluate(() => JSON.stringify(sent[0].payload));
assert(!/secret/.test(json), 'sent payload has no sensitive text, attributes, HTML or breadcrumbs');
const payload = JSON.parse(json);
assert(payload.breadcrumbs.some((b) => b.message === 'p#ssn'), 'breadcrumb names the sensitive element without its text');
assert(payload.selections.filter((s) => s.sensitive).length === 4, 'four sensitive selections flagged');
const region = payload.selections.find((s) => s.kind === 'region');
assert(region.selector === '#account' && region.text.includes('Visible label') && region.region.children.some((c) => c.sensitive), 'region keeps visible text and flags sensitive children');
assert(payload.masks.some((m) => m.reason === 'reporter') && payload.masks.some((m) => m.reason === 'sensitive'), 'payload lists sensitive and reporter masks');
const sentShot = `sent[0].attachments.find((a) => a.name === 'screenshot.png').blob`;
for (const selector of ['#ssn', '#card', '#late', '#hideme']) assert(await color(sentShot, selector) === MASK, `sent screenshot masks ${selector}`);
assert(await color(sentShot, '#target') === RED, 'sent screenshot keeps ordinary pixels');
const regionCrop = `sent[0].attachments.find((a) => a.name === 'selection-${payload.selections.indexOf(region) + 1}.png').blob`;
const origin = JSON.stringify([region.region.docRect.x - 16, region.region.docRect.y - 16]);
assert(await color(regionCrop, '#ssn', origin) === MASK && await color(regionCrop, '#card', origin) === MASK, 'region crop masks sensitive descendants');
assert(await color(regionCrop, '#visible', origin) === RED, 'region crop keeps visible content');
const directCrop = `sent[0].attachments.find((a) => a.name === 'selection-2.png').blob`;
const direct = payload.selections[1].docRect;
assert(await color(directCrop, '#ssn', JSON.stringify([direct.x - 16, direct.y - 16])) === MASK, 'crop of a sensitive pick is masked');
await finish();
