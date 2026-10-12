// Production artifact smoke test: deliberately no SPA fallback or development API.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, W } from '../lib.mjs';

const root = fileURLToPath(new URL('../../docs/.vitepress/dist/', import.meta.url));
const requests = [];
const server = createServer(async (req, res) => {
  requests.push(req.url);
  const url = new URL(req.url, 'http://localhost');
  const relative = decodeURIComponent(url.pathname).replace(/^\/lightback\//, '');
  const file = path.resolve(root, relative + (url.pathname.endsWith('/') ? 'index.html' : ''));
  if (!file.startsWith(root)) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = process.env.DEMO_URL || `http://127.0.0.1:${server.address().port}/lightback/demo/`;
const { browser, page, OUT, assert, finish } = await launch('static-demo');
const outbound = [];
page.on('request', (request) => { if (/^https?:/.test(request.url())) outbound.push(request); });

try {
  await page.goto(base);
  await page.locator('[data-ref=demo-intro]').waitFor();
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller), 'demo API ready before app mounts');
  await page.screenshot({ path: OUT + 'desktop.png', fullPage: true });
  await page.click('[data-invoice-id="INV-1044"] [data-action=pay]');
  await page.locator('[data-invoice-id="INV-1044"] .error-text').waitFor();
  const xhrResponse = page.waitForResponse((res) => res.url().endsWith('/api/invoices'));
  await page.click('[data-action=xhr-success]');
  await xhrResponse;

  await page.click('[data-action=demo-pick]');
  await page.locator(W + '[data-action=cancel-pick]').waitFor();
  const card = await page.locator('[data-testid=stat-overdue]').boundingBox();
  await page.mouse.click(card.x + 10, card.y + 10);
  await page.locator(W + '[data-ref=popover]').waitFor();
  await page.fill(W + '[data-ref=popText]', 'The overdue payment fails');
  await page.click(W + '[data-action=pop-more]');
  const region = await page.locator('[data-testid=stat-outstanding]').boundingBox();
  await page.mouse.move(region.x + 5, region.y + 5);
  await page.mouse.down();
  await page.mouse.move(region.x + region.width - 5, region.y + region.height - 5, { steps: 8 });
  await page.mouse.up();
  await page.locator(W + '[data-ref=popover]').waitFor();
  await page.fill(W + '[data-ref=popText]', 'Please check this total too');
  await page.click(W + '[data-action=pop-send]');
  await page.locator(W + '[data-ref=pending]').waitFor();
  await page.click(W + '[data-action=pending-edit]');
  await page.click(W + '[data-action=send]');
  await page.locator(W + '.lb-toast:not([hidden])').waitFor({ timeout: 20000 });
  await page.click('[data-action=demo-inbox]');
  await page.locator('[data-ref=submission]').waitFor();
  await page.click('[data-action=tab-json]');
  const payload = JSON.parse(await page.locator('[data-ref=payload-json]').textContent());
  assert(payload.selections.length === 2 && payload.selections.some((s) => s.kind === 'region'), 'element and region selections saved');
  assert(payload.selections[0].components.includes('StatCard'), 'production demo preserves readable component names');
  assert(payload.selections.map((s) => s.note).join('|') === 'The overdue payment fails|Please check this total too', 'selection notes saved');
  assert(payload.attachments.length === 3, 'base screenshot and both crops saved');
  assert(payload.network.some((n) => n.status === 500 && n.url.endsWith('/api/fail')), 'simulated payment failure captured');
  assert(payload.network.some((n) => n.kind === 'xhr' && n.status === 200), 'simulated XHR captured');
  assert(!JSON.stringify(payload).includes('eyJhbGci'), 'demo authorization token redacted');
  await page.click('[data-action=tab-summary]');
  await page.waitForFunction(() => [...document.querySelectorAll('img.crop')].length === 2 && [...document.querySelectorAll('img.crop')].every((img) => img.complete && img.naturalWidth > 0));
  await page.screenshot({ path: OUT + 'inbox.png', fullPage: true });
  await page.click('[data-action=tab-prompt]');
  assert((await page.locator('.inbox-detail pre').textContent()).includes('The overdue payment fails'), 'prompt renders report context');
  await page.click('[data-action=tab-screenshot]');
  await page.waitForFunction(() => document.querySelector('.shot-wrap img')?.naturalWidth > 0);
  assert(await page.locator('.shot-box:not(.child)').count() === 2, 'screenshot overlays render both selections');
  await page.reload();
  await page.locator('[data-ref=submission]').waitFor();
  assert(page.url().endsWith('#/inbox'), 'inbox refresh works without server rewrites');
  await page.waitForFunction(() => [...document.querySelectorAll('img.crop')].length === 2 && [...document.querySelectorAll('img.crop')].every((img) => img.naturalWidth > 0));
  assert(true, 'reports and screenshot crops survive a reload');
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(base + '#/inbox');
  await otherPage.locator('.inbox-list .empty').waitFor();
  assert(await otherPage.locator('[data-ref=submission]').count() === 0, 'different browser storage has an empty inbox');
  await other.close();

  // Seed older records, then send through the actual widget to exercise retention.
  await page.evaluate(async (payload) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('lightback-demo', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('submissions', 'readwrite');
        for (let i = 0; i < 20; i++) {
          tx.objectStore('submissions').put({ id: `older-${i}`, receivedAt: new Date(i * 1000).toISOString(), payload: { ...payload, id: `older-${i}`, selections: [], attachments: [] }, files: {} });
        }
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, payload);
  await page.click(W + '[data-action=open]');
  await page.fill(W + '[data-ref=text]', 'Newest report');
  await page.click(W + '[data-action=send]');
  await page.waitForFunction(() => document.querySelectorAll('[data-ref=submission]').length === 20);
  await page.reload();
  await page.locator('[data-ref=submission]').first().waitFor();
  assert(await page.locator('[data-ref=submission]').count() === 20, 'inbox retains at most 20 reports');
  assert((await page.locator('[data-ref=submission]').first().textContent()).includes('Newest report'), 'newest report survives retention cleanup');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: OUT + 'mobile-inbox.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile inbox fits viewport');
  await page.click('[data-action=clear-inbox]');
  await page.locator('.inbox-list .empty').waitFor();
  await page.reload();
  await page.locator('.inbox-list .empty').waitFor();
  assert(await page.locator('[data-ref=submission]').count() === 0, 'Clear removes reports across reloads');
  await page.click('[data-action=nav-dashboard]');
  await page.screenshot({ path: OUT + 'mobile.png', fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile dashboard fits viewport');
  await page.goBack();
  await page.locator('.inbox-list').waitFor();
  assert(true, 'browser Back restores inbox route');
  assert(outbound.every((request) => new URL(request.url()).origin === new URL(base).origin), 'demo makes no external API requests');
  assert(outbound.every((request) => !request.url().includes('/api/feedback')), 'reports never use an upload endpoint');
  assert(!requests.some((url) => url.includes('/api/')), 'simulated API requests never reach the static server');

  // A denied store should produce actionable UI, without an unhandled rejection.
  await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new Error('Site storage is blocked'); }; });
  await page.reload();
  await page.locator('[data-ref=inbox-error]').waitFor();
  assert((await page.locator('[data-ref=inbox-error]').textContent()).includes('storage'), 'storage failure is visible in inbox');
  await page.click(W + '[data-action=open]');
  await page.fill(W + '[data-ref=text]', 'Keep this draft on failure');
  await page.click(W + '[data-action=send]');
  await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('[data-ref=status]').textContent.includes('storage'));
  assert(await page.inputValue(W + '[data-ref=text]') === 'Keep this draft on failure', 'failed storage keeps the draft available for retry');
  await finish();
} catch (error) {
  await page.screenshot({ path: OUT + 'failure.png', fullPage: true }).catch(() => {});
  console.error('Demo failure state:', await page.evaluate(() => ({
    url: location.href,
    body: document.body.innerText.slice(0, 3000),
    controlled: !!navigator.serviceWorker.controller,
  })).catch(() => null));
  throw error;
} finally {
  await browser.close();
  server.close();
}
