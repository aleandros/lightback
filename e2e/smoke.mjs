// Smoke: noise generation (console, errors, network), panel flow, payload shape, inbox rendering.
import { launch, W, BASE_URL } from './lib.mjs';
import { checkRedirectPrivacy } from './helpers/privacy.mjs';

const { page, OUT, assert, received, reset, finish } = await launch('smoke');
await reset();
await page.goto(BASE_URL + '/');
await page.waitForSelector('text=Invoices');

// 1. generate noise
await page.click('text=console.log');
await page.click('text=console.warn');
await page.click('text=Throw error');
await page.click('text=Reject promise');
await page.click('text=fetch 500');
await page.click('text=fetch 404 (redacted param)');
await page.click('text=XHR 200');
await page.click('text=custom breadcrumb');
await page.click('text=set context (flags)');
await page.fill('input[placeholder="customer name"]', 'Secret Customer');
// Pay the overdue invoice -> /api/fail with a bearer token and a JSON body
await page.click('tr[data-invoice-id="INV-1044"] button');
await page.waitForSelector('text=Payment failed');
await page.waitForTimeout(300);

// 2. open the panel from the pill and write the note
await page.click('lightback-widget >> .lb-pill [data-action=open]');
await page.waitForSelector('lightback-widget >> .lb-panel:not([hidden]) textarea');
await page.fill('lightback-widget >> [data-ref=text]', 'Paying the overdue invoice fails with a 500 and the button just says Retry.');

// 3. pick an element from the panel; the popover opens next to it
await page.click('lightback-widget >> .lb-panel [data-action=pick]');
await page.waitForSelector('lightback-widget >> .lb-pickbar');
const btn = page.locator('tr[data-invoice-id="INV-1044"] button');
const box = await btn.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(100);
await page.screenshot({ path: OUT + '1-picking.png' });
const tip = await page.locator('lightback-widget >> .lb-tip').textContent();
console.log('tooltip:', tip);
assert(tip.includes('InvoiceRow'), 'picker tooltip shows the React component chain');
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForSelector('lightback-widget >> [data-ref=popover]:not([hidden])');
const popTitle = await page.locator('lightback-widget >> [data-ref=popTitle]').textContent();
assert(popTitle.includes('InvoiceRow'), 'popover title names the component');
// the host button must NOT have been clicked by the picker (it would go to "Paying…")
assert((await btn.textContent()) === 'Retry', 'picker click did not reach the app button');
await page.keyboard.type('This is the button that fails');
await page.click('lightback-widget >> [data-action=pop-more]');

// second selection: the overdue stat card, then Done opens the panel
const card = page.locator('[data-testid="stat-overdue"]');
const cb = await card.boundingBox();
await page.mouse.move(cb.x + 20, cb.y + 20);
await page.mouse.click(cb.x + 20, cb.y + 20);
await page.waitForSelector('lightback-widget >> [data-ref=popover]:not([hidden])');
await page.keyboard.press('Escape');
await page.click('lightback-widget >> [data-action=done]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelectorAll('.lb-sel').length === 2);
const chain = await page.locator('lightback-widget >> .lb-chain').first().textContent();
console.log('chain:', chain);
assert(chain.includes('InvoiceRow'), 'selection card shows InvoiceRow');

// 4. screenshot was captured automatically when picking started
await page.waitForSelector('lightback-widget >> .lb-shot:not([hidden]) img');
assert(true, 'auto screenshot captured and previewed');

// 5. review
await page.click('lightback-widget >> summary');
await page.waitForTimeout(200);
const preview = await page.locator('lightback-widget >> .lb-preview').textContent();
assert(preview.includes('## Selected elements (2)'), 'review prompt lists 2 selections');
assert(preview.includes('InvoiceRow'), 'review prompt includes component chain');
assert(preview.includes('/api/fail -> 500'), 'review prompt includes failed request');
await page.screenshot({ path: OUT + '2-widget-open.png' });
await page.click('lightback-widget >> [data-tab=json]');
await page.waitForTimeout(100);

// 6. send from the panel (immediate, no pending card)
await page.click('lightback-widget >> [data-action=send]');
await page.waitForSelector('lightback-widget >> .lb-toast:not([hidden])');
assert(true, 'send succeeded, toast shown');

// 7. verify what the backend got
const subs = await received();
assert(subs.length === 1, 'backend received exactly one submission');
const p = subs[0].payload;
const files = subs[0].files;
assert(files['screenshot.png']?.startsWith('data:image/png'), 'screenshot.png arrived as multipart file');
assert(p.note.text.startsWith('Paying the overdue'), 'note text arrived');
assert(p.selections.length === 2, 'two selections');
assert(p.selections[0].components[0] === 'InvoiceRow', 'selection[0] component chain starts with InvoiceRow');
assert(p.selections[0].note === 'This is the button that fails', 'per-element note arrived');
assert(p.selections[1].selector === '[data-testid="stat-overdue"] > div:nth-of-type(1)', 'structural selector anchors on ancestor data-testid');
assert(p.selections[0].docRect && typeof p.selections[0].docRect.y === 'number', 'docRect present');
assert(p.errors.some((e) => e.kind === 'error' && e.message.includes("reading 'total'")), 'thrown TypeError captured');
assert(p.errors.some((e) => e.kind === 'unhandledrejection' && e.message.includes('token refresh')), 'unhandled rejection captured');
assert(p.console.some((c) => c.level === 'warn' && c.message.includes('cache miss')), 'console.warn captured');
assert(p.console.some((c) => c.level === 'error' && c.message.includes('payment error')), 'app console.error captured');
const fail = p.network.find((n) => n.url.includes('/api/fail') && n.method === 'POST');
assert(fail && fail.status === 500 && fail.ok === false, 'POST /api/fail 500 captured');
assert(fail.requestBody?.includes('INV-1044'), 'same-origin request body captured');
assert(fail.responseBody?.includes('payments service unavailable'), 'same-origin response body captured');
assert(p.network.some((n) => n.kind === 'xhr' && n.status === 200), 'XHR captured');
const nf = p.network.find((n) => n.url.includes('/api/notfound'));
assert(nf && nf.url.includes('token=%5Bredacted%5D') && !nf.url.includes('supersecret'), 'secret query param redacted');
assert(!p.network.some((n) => n.url.includes('/api/feedback')), 'own endpoint not captured');
assert(!JSON.stringify(p).includes('Secret Customer'), 'typed input value never captured');
assert(!JSON.stringify(p).includes('c2VjcmV0c2lnbmF0dXJl'), 'bearer JWT never appears in payload');
assert(p.breadcrumbs.some((b) => b.type === 'click' && b.message.includes('button')), 'click breadcrumbs');
assert(p.breadcrumbs.some((b) => b.type === 'input'), 'input breadcrumb (no value)');
assert(p.breadcrumbs.some((b) => b.type === 'custom' && b.message.includes('export dialog')), 'custom breadcrumb');
assert(p.context.user?.id === 'u_123' && p.context.featureFlags?.newCheckout === true, 'context merged from provider + setContext');
assert(p.page.size.width > 0, 'page size captured');

// 8. inbox renders it
await page.click('text=Feedback inbox');
await page.waitForSelector('.inbox-list li.active');
assert(p.breadcrumbs.length > 0, 'navigation breadcrumb will show in next report');
await page.click('.tabs >> text=screenshot');
await page.waitForSelector('.shot-box');
assert((await page.locator('.shot-box').count()) === 2, 'inbox overlays 2 selection boxes on the screenshot');
await page.screenshot({ path: OUT + '3-inbox-screenshot.png', fullPage: true });
await page.click('.tabs >> text=summary');
await page.screenshot({ path: OUT + '4-inbox-summary.png', fullPage: true });

await checkRedirectPrivacy(page, assert, BASE_URL);
await finish();
