// Real IndexedDB/blob persistence across navigation; no playground inbox storage involved.
import { launch, W, BASE_URL } from './lib.mjs';
const { page, OUT, assert, finish } = await launch('session-recovery');
const corePath = '/@fs' + new URL('../packages/core/src/index.ts', import.meta.url).pathname;
const widgetPath = '/@fs' + new URL('../packages/widget/src/lazy.ts', import.meta.url).pathname;
const fixture = `<!doctype html><html><body>
<button data-ref="target" style="margin:100px;width:180px;height:60px">Report this</button>
<section data-ref="form"><textarea>never-store-this-input</textarea></section>
<script type="module">
import { createLightback } from ${JSON.stringify(corePath)};
import { mountLazyWidget } from ${JSON.stringify(widgetPath)};
window.sent = [];
window.client = createLightback({ persistence: { attachments: true }, redact: { patterns: [/private-token/g] },
 send: async (payload, attachments) => { window.sent.push({ payload, attachments }); } });
window.widget = mountLazyWidget({ client, sendDelay: 10000, screenshot: async () => {
 const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 860;
 const ctx = canvas.getContext('2d'); ctx.fillStyle = '#eeeeff'; ctx.fillRect(0, 0, 1280, 860);
 return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
} });
await client.ready;
window.fixtureReady = true;
</script></body></html>`;
await page.context().route('**/recovery-fixture.html', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
async function load() {
  await page.goto(BASE_URL + '/recovery-fixture.html');
  await page.waitForFunction(() => window.fixtureReady);
}
async function flush() { await page.evaluate(() => client.flushPersistence()); }
async function stored() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('lightback-recovery', 1); req.onsuccess = () => resolve(req.result); req.onerror = reject;
    });
    try {
      return await new Promise((resolve) => {
        const tx = db.transaction('sessions'); const request = tx.objectStore('sessions').get(sessionStorage.getItem('lightback:session:default'));
        request.onsuccess = () => resolve(request.result);
      });
    } finally { db.close(); }
  });
}
await load();
await page.evaluate(async () => {
  await fetch('/api/invoices?token=network-secret');
  console.warn('before reload private-token');
  window.dispatchEvent(new ErrorEvent('error', { message: 'error before reload' }));
  client.addBreadcrumb('before reload breadcrumb');
});
await page.click(W + '[data-ref=pillPick]');
await page.locator(W + '[data-action=done]').waitFor();
await page.click('[data-ref=target]');
await page.fill(W + '[data-ref=popText]', 'selection private-token');
// Reload while the popover is still open: its unsent input must be checkpointed.
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('.lb-thumb'));
await flush();
let record = await stored();
assert(!JSON.stringify(record).includes('private-token'), 'raw IndexedDB contains no configured secret');
assert(record.state.draft.attachments.length === 2, 'IndexedDB stores screenshot and crop blobs');
await load();
assert(await page.locator(W + '[data-ref=panel]').count() === 0, 'draft recovery keeps the lazy editor unloaded');
assert((await page.locator(W + '[data-ref=pillPick]').textContent()).includes('(1)'), 'lightweight pill shows recovered selection count');
await page.click(W + '[data-ref=pillOpen]');
await page.waitForFunction(() => document.querySelector('lightback-widget').shadowRoot.querySelector('.lb-thumb')?.complete);
assert((await page.locator(W + '[data-ref=selections]').textContent()).includes('selection [redacted]'), 'uncommitted selection note restored and redacted');
assert(await page.locator(W + '[data-ref=shot]').isVisible(), 'restored screenshot preview visible');
assert(await page.locator(W + '[data-ref=pending]').isHidden(), 'recovery does not auto-send');
await page.screenshot({ path: OUT + 'restored.png' });
const payload = await page.evaluate(() => client.buildPayload({}));
assert(payload.console.some((e) => e.message === 'before reload [redacted]'), 'console recovered');
assert(payload.network.some((e) => e.url.includes('/api/invoices') && !e.url.includes('network-secret') && e.status === 200), 'network context recovered with query secrets redacted');
assert(payload.errors.some((e) => e.message === 'error before reload'), 'errors recovered');
assert(payload.breadcrumbs.some((e) => e.message === 'before reload breadcrumb'), 'breadcrumbs recovered');
await page.fill(W + '[data-ref=text]', 'general note');
await flush();
await load();
await page.click(W + '[data-ref=pillOpen]');
assert(await page.inputValue(W + '[data-ref=text]') === 'general note', 'general note survives another reload');
await page.click(W + '[data-action=send]');
await page.waitForFunction(() => window.sent.length === 1);
await page.locator(W + '[data-ref=pill]').waitFor();
assert(await page.evaluate(() => sent[0].attachments.every((a) => a.blob instanceof Blob && a.blob.size > 0) && sent[0].attachments.length === 2), 'restored blobs sent intact');
assert((await stored()) === undefined, 'successful send deletes recovery record');
await load();
await page.click(W + '[data-ref=pillOpen]');
assert(await page.inputValue(W + '[data-ref=text]') === '', 'sent draft does not return');
await page.fill(W + '[data-ref=text]', 'discard me');
await flush();
await page.click(W + '[data-action=discard]');
await flush();
assert((await stored()) === undefined, 'discard deletes draft and old context');
await load();
await page.click(W + '[data-ref=pillOpen]');
assert(await page.inputValue(W + '[data-ref=text]') === '', 'discarded draft does not return');
await page.fill(W + '[data-ref=text]', 'only this tab'); await flush();
const other = await page.context().newPage();
await other.goto(BASE_URL + '/recovery-fixture.html');
await other.waitForFunction(() => window.fixtureReady);
assert(await other.evaluate(() => client.getDraft() === null), 'another tab cannot restore this tab’s draft');
await other.close();
// A pending send returns as an editable draft, without a timer.
await page.click(W + '[data-ref=panel] [data-action=pick]');
await page.locator(W + '[data-action=done]').waitFor();
await page.click('[data-ref=target]');
await page.fill(W + '[data-ref=popText]', 'pending note');
await page.click(W + '[data-action=pop-send]');
await flush(); await load();
await page.click(W + '[data-ref=pillOpen]');
assert(await page.locator(W + '[data-ref=pending]').isHidden(), 'pending countdown is not restored');
assert((await page.locator(W + '[data-ref=selections]').textContent()).includes('pending note'), 'pending report becomes editable');
// Default metadata-only mode must not retain pixels, even from a previously opted-in record.
assert(await page.evaluate(async (corePath) => {
  widget.destroy(); client.destroy(); await client.flushPersistence();
  const { createLightback } = await import(corePath);
  const next = createLightback(); await next.ready;
  const metadataOnly = next.getDraft()?.attachments.length === 0;
  await next.clearPersistence(); next.destroy(); return metadataOnly;
}, corePath), 'turning off attachment persistence does not restore old blobs');
await finish();
