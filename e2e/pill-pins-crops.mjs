// Pill direct actions, pin removal, Cancel keeps draft, auto screenshot and per-selection crops.
import { launch, W, BASE_URL } from './lib.mjs';
import fs from 'node:fs';
import { checkCustomization } from './helpers/customization.mjs';

const { page, OUT, assert, received, reset, finish } = await launch('pill-pins-crops');
const pinCount = () => page.locator(W + '.lb-pin').count();
await reset();
// Force the legacy image decoder while retaining real canvas/crop assertions.
await page.addInitScript(() => { window.createImageBitmap = undefined; });
await page.goto(BASE_URL + '/');
await page.waitForSelector('text=Invoices');
await page.click('tr[data-invoice-id="INV-1044"] button');
await page.waitForSelector('text=Payment failed');

// ---- 1. pill offers direct actions
await page.screenshot({ path: OUT + '0-pill.png' });
const pillBtns = await page.locator(W + '.lb-pill button').allTextContents();
assert(pillBtns.length === 2 && pillBtns[0].includes('Point') && pillBtns[1].includes('Write'), `pill has direct actions: ${pillBtns.join(' | ')}`);
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForSelector(W + '.lb-pickbar');
assert(await page.locator(W + '.lb-panel').isHidden(), 'pick mode starts straight from the pill, no panel');

// ---- 2. select, then remove via popover
const retry = page.locator('tr[data-invoice-id="INV-1044"] button');
const rb = await retry.boundingBox();
await page.mouse.click(rb.x + 10, rb.y + 10);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
assert((await pinCount()) === 1, 'pin added');
await page.click(W + '[data-action=pop-remove]');
await page.waitForSelector(W + '[data-ref=popover]', { state: 'hidden' });
assert((await pinCount()) === 0, 'Remove in the popover drops the selection');
assert(await page.locator(W + '.lb-pickbar').isVisible(), 'still picking after remove');

// ---- 3. select two, remove one through the pin's ✕
await page.mouse.click(rb.x + 10, rb.y + 10);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
await page.keyboard.type('fails for overdue');
await page.click(W + '[data-action=pop-more]');
const card = await page.locator('[data-testid="stat-overdue"]').boundingBox();
await page.mouse.click(card.x + 8, card.y + 8);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
await page.click(W + '[data-action=pop-more]');
assert((await pinCount()) === 2, 'two pins');
const countText = await page.locator(W + '[data-ref=count]').textContent();
assert(countText === '2 selected', `pickbar shows count (${countText})`);
const pin2 = page.locator(W + '.lb-pin').nth(1);
await pin2.hover();
await page.screenshot({ path: OUT + '1-pin-hover.png' });
await pin2.locator('.lb-pin-x').click();
assert((await pinCount()) === 1, 'pin ✕ removes that selection');

// ---- 4. Cancel leaves pick mode but keeps the draft; pill reflects it
await page.click(W + '[data-action=cancel-pick]');
await page.waitForSelector(W + '.lb-pill:not([hidden])');
const pillAfter = await page.locator(W + '.lb-pill button').allTextContents();
assert(pillAfter[0].includes('(1)') && pillAfter[1].includes('Review'), `pill shows draft state: ${pillAfter.join(' | ')}`);
assert((await pinCount()) === 1, 'pin persists outside pick mode');
await page.screenshot({ path: OUT + '2-pill-draft.png' });

// ---- 5. region over modal, then Done -> auto screenshot + crops
await page.click('text=Export…');
await page.waitForSelector('.modal');
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForSelector(W + '.lb-pickbar');
const mb = await page.locator('.modal').boundingBox();
await page.mouse.move(mb.x - 100, mb.y + 60);
await page.mouse.down();
await page.mouse.move(mb.x - 60, mb.y + 90);
await page.mouse.move(mb.x + mb.width - 20, mb.y + mb.height - 70, { steps: 6 });
await page.mouse.up();
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
await page.keyboard.type('confusing form');
await page.click(W + '[data-action=done]');
await page.waitForSelector(W + '.lb-panel:not([hidden])');
await page.waitForSelector(W + '.lb-shot:not([hidden]) img');
assert(true, 'screenshot was attached automatically');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === 2, null, { timeout: 15000 });
assert(true, 'both selection cards show a crop thumbnail');
const shotBtn = await page.locator(W + '[data-ref=shotBtn]').textContent();
assert(shotBtn.includes('Retake'), 'screenshot button offers retake');
await page.screenshot({ path: OUT + '3-panel-crops.png' });
await page.click(W + '[data-action=send]');
await page.waitForSelector(W + '.lb-toast:not([hidden])');

// ---- 6. payload
const [sub] = await received();
const p = sub.payload;
const names = p.attachments.map((a) => a.name).sort();
assert(JSON.stringify(names) === JSON.stringify(['screenshot.png', 'selection-1.png', 'selection-2.png']), `attachments: ${names.join(', ')}`);
assert(p.selections[0].crop === 'selection-1.png' && p.selections[1].crop === 'selection-2.png', 'selections reference their crops');
assert(sub.files['selection-1.png']?.startsWith('data:image/png') && sub.files['selection-2.png']?.startsWith('data:image/png'), 'crop files received');
assert(p.selections[0].note === 'fails for overdue' && p.selections[1].note === 'confusing form', 'notes intact after removals');
assert(p.selections[1].kind === 'region' && p.selections[1].components[0] === 'ExportDialog', 'region is the dialog');
// crop dimensions sanity: crop 1 is small (button), crop 2 is large (region)
const dims = await page.evaluate(async (files) => {
  const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src; });
  return [await load(files['selection-1.png']), await load(files['selection-2.png'])];
}, sub.files);
console.log('crop sizes:', JSON.stringify(dims));
assert(dims[0][0] < 200 && dims[0][1] < 120 && dims[1][0] > 400 && dims[1][1] > 200, 'crop sizes match the selections');
for (const [i, name] of ['selection-1.png', 'selection-2.png'].entries()) {
  fs.writeFileSync(OUT + `crop-${i + 1}.png`, Buffer.from(sub.files[name].split(',')[1], 'base64'));
}
await page.click('.modal >> text=Cancel');
await page.click('text=Feedback inbox');
await page.waitForSelector('.inbox-list li.active');
await page.waitForSelector('img.crop');
await page.screenshot({ path: OUT + '4-inbox.png', fullPage: true });

await checkCustomization(page, assert, BASE_URL);
await finish();
