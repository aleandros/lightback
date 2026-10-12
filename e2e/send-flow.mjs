// Popover Send/Enter, pending card with Cancel/Edit, Add more, auto-send after delay, Discard.
import { launch, W, BASE_URL } from './lib.mjs';

const { page, OUT, assert, received, reset, finish } = await launch('send-flow');
await reset();
await page.goto(BASE_URL + '/');
await page.waitForSelector('text=Invoices');
await page.click('tr[data-invoice-id="INV-1044"] button');
await page.waitForSelector('text=Payment failed');
const rb = await page.locator('tr[data-invoice-id="INV-1044"] button').boundingBox();

// ---- A. one element, Enter -> pending card -> Cancel keeps draft, nothing sent
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForSelector(W + '.lb-pickbar');
await page.mouse.click(rb.x + 10, rb.y + 10);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
const popBtns = await page.locator(W + '.lb-pop-actions button').allTextContents();
assert(JSON.stringify(popBtns) === JSON.stringify(['Remove', 'Add more', 'Send']), `popover actions: ${popBtns.join(' | ')}`);
await page.screenshot({ path: OUT + '1-popover.png' });
await page.keyboard.type('Retry does nothing');
await page.keyboard.press('Enter');
await page.waitForSelector(W + '[data-ref=pending]:not([hidden])');
assert(await page.locator(W + '.lb-pickbar').isHidden() && await page.locator(W + '.lb-panel').isHidden(), 'Enter leaves pick mode and shows the pending card, no review step');
const summary = await page.locator(W + '[data-ref=pendingSummary]').textContent();
assert(summary.includes('1 selection') && summary.includes('Retry does nothing'), `pending summary: ${summary}`);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '2-pending.png' });
await page.click(W + '[data-action=pending-cancel]');
await page.waitForSelector(W + '.lb-pill:not([hidden])');
await page.waitForTimeout(300);
assert((await received()).length === 0, 'Cancel: nothing was sent');
assert((await page.locator(W + '.lb-pill button').first().textContent()).includes('(1)'), 'Cancel: draft kept');

// ---- B. Add more keeps picking; Send button -> pending -> Edit opens the panel; panel Send is immediate
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForSelector(W + '.lb-pickbar');
const card = await page.locator('[data-testid="stat-overdue"]').boundingBox();
await page.mouse.click(card.x + 8, card.y + 8);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
await page.keyboard.type('count looks wrong');
await page.click(W + '[data-action=pop-more]');
await page.waitForSelector(W + '[data-ref=popover]', { state: 'hidden' });
assert(await page.locator(W + '.lb-pickbar').isVisible(), 'Add more keeps pick mode');
const stat = await page.locator('[data-testid="stat-outstanding"]').boundingBox();
await page.mouse.click(stat.x + 8, stat.y + 8);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
await page.click(W + '[data-action=pop-send]');
await page.waitForSelector(W + '[data-ref=pending]:not([hidden])');
await page.click(W + '[data-action=pending-edit]');
await page.waitForSelector(W + '.lb-panel:not([hidden])');
assert((await page.locator(W + '.lb-sel').count()) === 3, 'Edit opens the panel with all 3 selections');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-thumb').length === 3, null, { timeout: 15000 });
await page.screenshot({ path: OUT + '3-edit-panel.png' });
await page.click(W + '[data-action=send]');
await page.waitForSelector(W + '.lb-toast:not([hidden])');
await page.waitForSelector(W + '.lb-toast', { state: 'hidden', timeout: 6000 });
let subs = await received();
assert(subs.length === 1 && subs[0].payload.selections.length === 3, 'panel Send delivers immediately with 3 selections');
assert(subs[0].payload.selections.map((s) => s.note).join('|') === 'Retry does nothing|count looks wrong|', 'notes preserved across cancel/edit');
assert(subs[0].payload.attachments.length === 4, `attachments: ${subs[0].payload.attachments.map((a) => a.name).join(', ')}`);

// ---- C. fast path: select, Enter, do nothing -> auto-sends after the delay with crop attached
await page.click(W + '.lb-pill [data-action=pick]');
await page.waitForSelector(W + '.lb-pickbar');
await page.mouse.click(rb.x + 10, rb.y + 10);
await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
await page.keyboard.press('Enter'); // no comment at all, immediately
await page.waitForSelector(W + '[data-ref=pending]:not([hidden])');
await page.waitForSelector(W + '[data-ref=pending]', { state: 'hidden', timeout: 12000 });
await page.waitForSelector(W + '.lb-toast:not([hidden])', { timeout: 12000 });
subs = await received();
assert(subs.length === 2, 'auto-sent after the delay');
const fast = subs[0].payload;
assert(fast.selections.length === 1 && fast.selections[0].crop === 'selection-1.png' && subs[0].files['selection-1.png'], 'fast send waited for the crop');
assert(subs[0].files['screenshot.png'], 'fast send includes the base screenshot');
assert(await page.locator(W + '.lb-pill:not([hidden])').isVisible(), 'pill is back after sending');
assert(!(await page.locator(W + '.lb-pill button').first().textContent()).includes('('), 'draft cleared after send');

// ---- D. Discard from panel
await page.click(W + '.lb-pill [data-action=open]');
await page.fill(W + 'textarea[data-ref=text]', 'draft to throw away');
await page.click(W + '[data-action=discard]');
await page.waitForSelector(W + '.lb-pill:not([hidden])');
assert(!(await page.locator(W + '.lb-pill button').nth(1).textContent()).includes('Review'), 'Discard clears the draft');

await finish();
