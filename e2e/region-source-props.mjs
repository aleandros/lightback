// Inline popover, drag-rectangle over a modal, source location and props in payload and inbox.
import { launch, W, BASE_URL } from './lib.mjs';

const { page, OUT, assert, received, reset, finish } = await launch('region-source-props');
const shadow = (fn) => page.evaluate((src) => { const r = document.querySelector('lightback-widget').shadowRoot; return eval(src)(r); }, fn.toString());
await reset();
await page.goto(BASE_URL + '/');
await page.waitForSelector('text=Invoices');
await page.click('text=fetch 500');
await page.click('tr[data-invoice-id="INV-1044"] button');
await page.waitForSelector('text=Payment failed');

// ---- 1. inline comment: click element -> popover appears next to it, focus stays on page
await page.click('text=Report an issue with an element');
await page.waitForSelector(W + '.lb-pickbar');
const retry = page.locator('tr[data-invoice-id="INV-1044"] button');
const rb = await retry.boundingBox();
await page.mouse.move(rb.x + 10, rb.y + 10);
await page.mouse.click(rb.x + 10, rb.y + 10);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
const popBox = await page.locator(W + '[data-ref=popover]').boundingBox();
assert(Math.abs(popBox.y - (rb.y + rb.height)) < 20 || Math.abs(popBox.y + popBox.height - rb.y) < 20, 'popover is anchored right next to the clicked element');
assert(await page.locator(W + '.lb-panel').isHidden(), 'panel stays closed while commenting inline');
const title = await page.locator(W + '[data-ref=popTitle]').textContent();
assert(title.includes('InvoiceRow'), `popover title names the component (${title})`);
const focused = await shadow((r) => r.activeElement?.dataset.ref);
assert(focused === 'popText', 'comment box is focused automatically');
await page.keyboard.type('This button keeps failing for overdue invoices');
await page.click(W + '[data-action=pop-more]');
await page.waitForSelector(W + '[data-ref=popover]', { state: 'hidden' });
assert(await page.locator(W + '.lb-pickbar').isVisible(), 'still in pick mode after saving a comment');
assert((await page.locator(W + '.lb-pin').count()) === 1, 'a numbered pin stays on the page');
await page.screenshot({ path: OUT + '1-inline-comment.png' });

// ---- 2. region over a modal: open the dialog, drag a rectangle that spills over the backdrop
await page.keyboard.press('Escape'); // leave pick mode, panel opens
await page.waitForSelector(W + '.lb-panel:not([hidden])');
await page.click(W + '[data-action=close]');
await page.click('text=Export…');
await page.waitForSelector('.modal');
await page.click(W + '.lb-pill [data-action=open]');
await page.click(W + '.lb-panel [data-action=pick]');
await page.waitForSelector(W + '.lb-pickbar');
const mb = await page.locator('.modal').boundingBox();
// Start well outside the modal (on the backdrop, over the table behind it) and end inside the modal over the two selects.
const sx = mb.x - 120, sy = mb.y + 60;
const ex = mb.x + mb.width - 20, ey = mb.y + mb.height - 70;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 40, sy + 30);
await page.mouse.move(ex, ey, { steps: 8 });
await page.screenshot({ path: OUT + '2-dragging.png' });
await page.mouse.up();
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
const regionTitle = await page.locator(W + '[data-ref=popTitle]').textContent();
console.log('region title:', regionTitle);
assert(regionTitle.startsWith('Area in ExportDialog'), 'region container resolved to the dialog, not the backdrop or the table');
await page.keyboard.type('The whole form is confusing');
await page.click(W + '[data-action=pop-more]');
await page.waitForSelector(W + '[data-ref=popover]', { state: 'hidden' });
assert((await page.locator(W + '.lb-pin').count()) === 2, 'two pins on the page');
await page.screenshot({ path: OUT + '3-region-pins.png' });

// ---- 3. Done -> panel shows both cards with comments, source and children
await page.click(W + '[data-action=done]');
await page.waitForSelector(W + '.lb-panel:not([hidden])');
const cards = await page.locator(W + '.lb-sel').allTextContents();
assert(cards.length === 2, 'two selection cards');
assert(cards[0].includes('This button keeps failing'), 'card 1 shows the inline comment');
assert(/Dashboard\.tsx:\d+:\d+/.test(cards[0]), `card 1 shows a source location (${cards[0].match(/Dashboard\.tsx:\d+:\d+/)?.[0]})`);
assert(cards[1].includes('area') && cards[1].includes('The whole form'), 'card 2 is an area with its comment');
await page.fill(W + 'textarea[data-ref=text]', 'Overdue payment fails and the export dialog is confusing.');
await page.click(W + '[data-action=shot]');
await page.waitForSelector(W + '.lb-shot:not([hidden]) img');
await page.screenshot({ path: OUT + '4-panel.png' });
await page.click(W + '[data-action=send]');
await page.waitForSelector(W + '.lb-toast:not([hidden])');

// ---- 4. payload
const [sub] = await received();
const p = sub.payload;
const [s1, s2] = p.selections;
assert(s1.kind === 'element' && s1.note === 'This button keeps failing for overdue invoices', 'element selection with note');
assert(s1.source && /Dashboard\.tsx$/.test(s1.source.file) && s1.source.line > 0, `source location captured: ${s1.source?.file}:${s1.source?.line}:${s1.source?.column}`);
assert(s1.chain[0].name === 'InvoiceRow' && s1.chain[0].source?.line > 0, 'chain entries carry their own source');
assert(s1.props?.invoice?.id === 'INV-1044' && s1.props.invoice.status === 'overdue', `props snapshot of InvoiceRow: ${JSON.stringify(s1.props)}`);
assert(s2.kind === 'region' && s2.components[0] === 'ExportDialog', 'region container is ExportDialog');
assert(s2.region.children.length >= 3, `region lists ${s2.region.children.length} visible children`);
const childText = s2.region.children.map((c) => `${c.tag}:${c.text}`).join(' | ');
console.log('children:', childText);
assert(!childText.includes('INV-10'), 'nothing from the table behind the backdrop leaked into the region');
assert(s2.region.children.some((c) => c.tag === 'select' || c.tag === 'label'), 'the selects/labels are among the children');
assert(s2.note === 'The whole form is confusing', 'region note arrived');
assert(s2.props && 'onClose' in s2.props && s2.props.onClose === '[fn onClose]', 'region props snapshot (function stripped)');
const md = (await import('../packages/core/dist/index.js')).toPromptContext(p);
assert(md.includes('Region inside <div>') && md.includes('Contains'), 'prompt renders the region');
assert(/Source: src\/Dashboard\.tsx:\d+:\d+/.test(md), 'prompt renders source locations');
console.log('\n--- prompt excerpt ---\n' + md.split('\n').slice(0, 40).join('\n') + '\n---');

// ---- 5. inbox
await page.click('.modal >> text=Cancel');
await page.click('text=Feedback inbox');
await page.waitForSelector('.inbox-list li.active');
await page.click('.tabs >> text=screenshot');
await page.waitForSelector('.shot-box.region');
await page.screenshot({ path: OUT + '5-inbox-shot.png', fullPage: true });
await page.click('.tabs >> text=summary');
await page.screenshot({ path: OUT + '6-inbox-summary.png', fullPage: true });

await finish();
