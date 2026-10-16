// Large DOMs: whole-page captures are skipped over the element budget; viewport captures stay fast and correct.
import { launch, W, BASE_URL } from './lib.mjs';
import fs from 'node:fs';

const { page, OUT, assert, received, reset, finish } = await launch('large-page');
const ROWS = 3000; // ~93k elements, about 25 s for a whole-page modern-screenshot capture

async function bigTable(query) {
  await reset();
  await page.goto(BASE_URL + '/' + query);
  await page.waitForSelector('text=Invoices');
  await page.evaluate((rows) => {
    const t = document.createElement('table');
    t.id = 'big';
    let html = '';
    for (let r = 0; r < rows; r++) html += '<tr>' + Array.from({ length: 10 }, (_, c) => `<td><span>r${r}c${c}</span> <em>x</em></td>`).join('') + '</tr>';
    t.innerHTML = '<tbody>' + html + '</tbody>';
    document.querySelector('main').appendChild(t);
  }, ROWS);
}

/** Select a cell, wait until `crops` crops exist (so any capture has finished), and report scrollY around it. */
async function pickCell(row, col, crops) {
  const cell = page.locator(`#big tr:nth-child(${row}) td:nth-child(${col})`);
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.click(b.x + 4, b.y + 4);
  await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
  await page.waitForFunction((n) => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === n, crops, { timeout: 20000 });
  const after = await page.evaluate(() => scrollY);
  await page.click(W + '[data-action=pop-more]');
  return { before, after };
}

/** Dark (text) pixels in each named image: a blank or misplaced capture has none. */
const darkPixels = (files, names) => page.evaluate(async ([files, names]) => {
  const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
  const out = [];
  for (const name of names) {
    const img = await load(files[name]);
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) dark++;
    out.push(dark);
  }
  return out;
}, [files, names]);

const shotAttached = () => page.locator(W + '[data-ref=shot]').isVisible();

// ---- 1. whole-page mode over the budget: no automatic capture, no freeze, manual capture still offered
await bigTable('?shot=page');
let t0 = Date.now();
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForSelector(W + '[data-ref=toast]:not([hidden])');
const toast = await page.locator(W + '[data-ref=toast]').textContent();
assert(toast.includes('Large page'), `skipped capture is explained (${toast})`);
await pickCell(20, 3, 0);
await page.click(W + '[data-action=done]');
await page.waitForSelector(W + '.lb-panel:not([hidden])');
assert(Date.now() - t0 < 10000, `pick and select stay responsive (${Date.now() - t0} ms)`);
assert(!(await shotAttached()), 'no screenshot attached automatically');
assert(await page.locator(W + '[data-ref=shotBtn]').isVisible(), 'Screenshot button still offered');
await page.click(W + '[data-action=send]');
await page.locator(W + '[data-ref=missingShot]').waitFor();
assert(await page.locator(W + '[data-ref=shotBtn]').getAttribute('data-attention') === 'true', 'skipped screenshot button stays highlighted');
await page.click(W + '[data-action=send-anyway]');
await page.waitForSelector(W + '[data-ref=toast]:not([hidden])');
let [sub] = await received();
assert(sub.payload.attachments.length === 0 && !sub.payload.selections[0].crop, 'report sent without images');

// ---- 2. viewport mode: fast capture of what is on screen, crops line up, a scrolled selection gets a fresh capture
await bigTable('');
await page.evaluate(() => window.scrollTo(0, 20000));
t0 = Date.now();
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForSelector(W + '[data-ref=shot]', { state: 'attached' });
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]').src.startsWith('blob:'), null, { timeout: 20000 });
const captureMs = Date.now() - t0;
assert(captureMs < 15000, `viewport capture on ${ROWS} rows finishes quickly (${captureMs} ms)`);
const firstRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#big tr')];
  return rows.findIndex((r) => r.getBoundingClientRect().top >= 0) + 1;
});
await pickCell(firstRow + 3, 2, 1);
const scrolled = await pickCell(firstRow + 400, 5, 2); // off the first capture
// WebKit scrolled to the top when the capture hid the widget while its comment box had focus.
assert(scrolled.after === scrolled.before, `a fresh capture keeps the scroll position (${scrolled.before} -> ${scrolled.after})`);
await page.click(W + '[data-action=done]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === 2, null, { timeout: 20000 });
await page.screenshot({ path: OUT + '1-viewport-panel.png' });
await page.click(W + '[data-action=send]');
await page.waitForSelector(W + '[data-ref=toast]:not([hidden])');
[sub] = await received();
const p = sub.payload;
const att = Object.fromEntries(p.attachments.map((a) => [a.name, a]));
const shot = att['screenshot.png'];
const vp = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }));
assert(shot?.area && shot.area.y > 0 && shot.area.width === vp.w && shot.area.height === vp.h, `screenshot shows the viewport (${JSON.stringify(shot?.area)})`);
const inside = (outer, r) => r.x >= outer.x && r.y >= outer.y && r.x + r.width <= outer.x + outer.width && r.y + r.height <= outer.y + outer.height;
assert(!inside(shot.area, p.selections[0].docRect), 'historical selection lies outside the refreshed screenshot area');
assert(inside(shot.area, p.selections[1].docRect), 'latest selection lies in the refreshed screenshot area');
for (const [i, sel] of p.selections.entries()) {
  const crop = att[sel.crop];
  assert(crop?.area && inside(crop.area, sel.docRect), `crop ${i + 1} records an area around its selection`);
}
// Pixels: each crop must show its cell's dark label text, not an empty or misplaced patch of page.
const dark = await darkPixels(sub.files, ['selection-1.png', 'selection-2.png']);
assert(dark.every((n) => n > 10), `crops contain cell text (${dark.join(', ')} dark pixels)`);

// ---- 3. an app root with height: 100% whose content overflows it, scrolled: the capture must not come out blank,
// and typing right after a selection that needs a fresh capture keeps every keystroke in the comment box
await bigTable('');
await page.evaluate(() => {
  for (const el of [document.documentElement, document.body, document.getElementById('root')]) el.style.height = '100%';
  window.scrollTo(0, 20000);
});
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=shotImg]')?.src?.startsWith('blob:'), null, { timeout: 20000 });
const lateRow = await page.evaluate(() => [...document.querySelectorAll('#big tr')].findIndex((r) => r.getBoundingClientRect().top >= 0) + 400);
const late = page.locator(`#big tr:nth-child(${lateRow}) td:nth-child(3)`);
await late.scrollIntoViewIfNeeded();
const lb = await late.boundingBox();
await page.mouse.click(lb.x + 4, lb.y + 4);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
await page.keyboard.type('typed during the capture');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === 1, null, { timeout: 20000 });
const typed = await page.locator(W + '[data-ref=popText]').inputValue();
assert(typed === 'typed during the capture', `keystrokes during a fresh capture reach the comment box (${JSON.stringify(typed)})`);
await page.click(W + '[data-action=pop-more]');
await page.click(W + '[data-action=done]');
await page.click(W + '[data-action=send]');
await page.waitForSelector(W + '[data-ref=toast]:not([hidden])');
[sub] = await received();
for (const n of ['screenshot.png', 'selection-1.png']) fs.writeFileSync(OUT + `tall-${n}`, Buffer.from(sub.files[n].split(',')[1], 'base64'));
const tall = await darkPixels(sub.files, ['screenshot.png', 'selection-1.png']);
assert(tall.every((n) => n > 10), `screenshot and crop of a height: 100% layout show the page (${tall.join(', ')} dark pixels)`);
assert(sub.payload.selections[0].note === 'typed during the capture', 'the note is complete');

// ---- 4. whole-page mode on an ordinary page: unchanged behaviour, area is the whole document
await reset();
await page.goto(BASE_URL + '/?shot=page');
await page.waitForSelector('text=Invoices');
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForSelector(W + '.lb-pickbar');
const card = await page.locator('[data-testid="stat-overdue"]').boundingBox();
await page.mouse.click(card.x + 8, card.y + 8);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
await page.click(W + '[data-action=done]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === 1, null, { timeout: 15000 });
await page.click(W + '[data-action=send]');
await page.waitForSelector(W + '[data-ref=toast]:not([hidden])');
[sub] = await received();
const size = sub.payload.page.size;
const area = sub.payload.attachments.find((a) => a.name === 'screenshot.png')?.area;
assert(area && area.x === 0 && area.y === 0 && area.width === size.width && area.height === size.height, `whole-page screenshot area matches page.size (${JSON.stringify(area)})`);

await finish();
