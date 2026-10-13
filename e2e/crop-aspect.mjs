// Region crops keep their natural proportions in widget thumbnails and inbox previews, at DPR 1 and 2.
import { launch, W, BASE_URL } from './lib.mjs';

const { browser, page: page1, OUT, assert, received, reset, finish } = await launch('crop-aspect');
const PAD = 16; // default cropPadding

// Content-box size of each matching image next to its natural size.
const measure = (page, inShadow, selector) => page.evaluate(({ inShadow, selector }) => {
  const root = inShadow ? document.querySelector('lightback-widget').shadowRoot : document;
  return Array.from(root.querySelectorAll(selector)).map((img) => {
    const cs = getComputedStyle(img);
    const px = (p) => parseFloat(cs[p]) || 0;
    return {
      natural: [img.naturalWidth, img.naturalHeight],
      shown: [
        img.clientWidth - px('paddingLeft') - px('paddingRight'),
        img.clientHeight - px('paddingTop') - px('paddingBottom'),
      ],
    };
  });
}, { inShadow, selector });

function checkPreviews(label, items, dpr, expected) {
  assert(items.length === expected.length, `${label}: ${items.length} previews`);
  items.forEach(({ natural, shown }, i) => {
    const [nw, nh] = natural;
    const [sw, sh] = shown;
    console.log(`${label} #${i + 1} (${expected[i]}): natural ${nw}×${nh}, shown ${sw.toFixed(1)}×${sh.toFixed(1)}`);
    // One CSS pixel of rounding on either axis, scaled into a ratio tolerance.
    const tolerance = (nw / nh) * (1 / Math.max(1, sw) + 1 / Math.max(1, sh)) + 0.01;
    assert(Math.abs(sw / sh - nw / nh) <= tolerance, `${label} #${i + 1} (${expected[i]}) keeps its aspect ratio`);
    assert(sw <= nw / dpr + 1 && sh <= nh / dpr + 1, `${label} #${i + 1} (${expected[i]}) is not enlarged past its natural size`);
  });
}

async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 8, y0 + 8);
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
  await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
  await page.click(W + '[data-action=pop-more]');
  await page.waitForSelector(W + '[data-ref=popover]', { state: 'hidden' });
}

async function run(page, dpr) {
  await reset();
  await page.goto(BASE_URL + '/');
  await page.waitForSelector('text=Invoices');
  const table = await page.locator('table').first().boundingBox();
  await page.click(W + '.lb-pill [data-action=pick]');
  await page.waitForSelector(W + '.lb-pickbar');
  // Viewport-space rects; the page is not scrolled, so they equal document space.
  const regions = {
    wide: { x: table.x + 4, y: table.y + 4, w: Math.min(table.width - 8, 700), h: 24 },
    // Start away from earlier pins, which take pointer events.
    tall: { x: table.x + 320, y: table.y + 44, w: 24, h: Math.min(table.height - 52, 260) },
    small: { x: table.x + 520, y: table.y + 64, w: 10, h: 8 },
  };
  const names = Object.keys(regions);
  for (const r of Object.values(regions)) await drag(page, r.x, r.y, r.x + r.w, r.y + r.h);
  await page.click(W + '[data-action=done]');
  await page.waitForSelector(W + '.lb-panel:not([hidden])');
  await page.waitForFunction(() => {
    const imgs = document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb');
    return imgs.length === 3 && Array.from(imgs).every((i) => i.complete && i.naturalWidth > 0);
  }, null, { timeout: 15000 });
  await page.screenshot({ path: OUT + `dpr${dpr}-1-panel.png` });

  checkPreviews(`widget dpr${dpr}`, await measure(page, true, '.lb-thumb'), dpr, names);

  await page.click(W + '[data-action=send]');
  await page.waitForSelector(W + '.lb-toast:not([hidden])');
  const [sub] = await received();
  const sels = sub.payload.selections;
  assert(sels.length === 3 && sels.every((s) => s.kind === 'region'), `dpr${dpr}: three region selections sent`);
  // Exported bytes: the drawn rect plus padding, scaled by the capture DPR, clipped to the document.
  const files = sels.map((s) => sub.files[s.crop]);
  const dims = await page.evaluate(async (srcs) => Promise.all(srcs.map((src) => new Promise((r) => {
    const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src;
  }))), files);
  sels.forEach((s, i) => {
    const d = s.region.docRect;
    const w = (Math.min(d.x + d.width + PAD, sub.payload.page.size?.width ?? Infinity) - Math.max(0, d.x - PAD)) * dpr;
    const h = (d.height + 2 * PAD) * dpr;
    console.log(`export dpr${dpr} ${names[i]}: ${dims[i][0]}×${dims[i][1]} for docRect ${d.width}×${d.height}`);
    assert(Math.abs(dims[i][0] - w) <= 2 * dpr && Math.abs(dims[i][1] - h) <= 2 * dpr, `dpr${dpr}: exported ${names[i]} crop matches its region plus padding`);
  });

  await page.click('text=Feedback inbox');
  await page.waitForSelector('.inbox-list li.active');
  await page.waitForFunction(() => {
    const imgs = document.querySelectorAll('img.crop');
    return imgs.length === 3 && Array.from(imgs).every((i) => i.complete && i.naturalWidth > 0);
  });
  await page.screenshot({ path: OUT + `dpr${dpr}-2-inbox.png`, fullPage: true });
  // The inbox does not know the capture scale, so it may show device pixels 1:1, never more.
  checkPreviews(`inbox dpr${dpr}`, await measure(page, false, 'img.crop'), 1, names);
}

await run(page1, 1);
const context2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const page2 = await context2.newPage();
await run(page2, 2);

await finish();
