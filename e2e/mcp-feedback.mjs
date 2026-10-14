// Real browser widget → HTTP receiver → stdio MCP → fixture code edit → reply/follow-up.
// The coding step is deterministic; no model/provider account is required.
import { strict as check } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const resolve = path => fileURLToPath(new URL('../' + path, import.meta.url));
import { createRequire } from 'node:module';
import { launch, W } from './lib.mjs';
import { makeConfig, writeConfig, startReceiver } from '../packages/mcp/dist/index.js';
const requireMcp = createRequire(new URL('../packages/mcp/package.json', import.meta.url));
const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
const { build } = createRequire(new URL('../package.json', import.meta.url))('tsup');
const dir = await mkdtemp(join(tmpdir(), 'lightback-browser-mcp-'));
const { page, OUT, assert, finish, browser } = await launch('mcp-feedback');
let receiver, client, app;
try {
  // A standalone frontend, with only browser entry points bundled.
  const entry = join(dir, 'app.ts');
  const source = join(dir, 'Button.html');
  await writeFile(source, '<button data-testid="target" data-source="Button.html:1:1" style="background:rgb(180,30,30);padding:24px">Save draft</button>');
  await writeFile(entry, `
    import { createLightback } from ${JSON.stringify(resolve('packages/core/src/index.ts'))};
    import { mountWidget } from ${JSON.stringify(resolve('packages/widget/src/index.ts'))};
    import { createFeedbackBridge, mountFeedbackThread } from ${JSON.stringify(resolve('packages/mcp/src/browser.ts'))};
    window.unhandledRejections = [];
    window.addEventListener('unhandledrejection', event => window.unhandledRejections.push(String(event.reason)));
    const bridge = createFeedbackBridge(window.connection);
    const client = createLightback({ send: (payload, attachments) => { window.lastSubmittedPayload = payload; return bridge.send(payload, attachments); }, persistence: false, redact: { patterns: [/PRIVATE_WORD/g] } });
    bridge.connect(client);
    const widget = mountWidget({ client, sendDelay: 0, screenshot: async ({area}) => {
      const canvas = document.createElement('canvas'); canvas.width = area.width; canvas.height = area.height;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
      return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }});
    const thread = mountFeedbackThread({ bridge, pollInterval: 1000 });
    window.testBridge = { client, bridge, widget, thread };
  `);
  await build({ entry: [entry], outDir: join(dir, 'dist'), format: ['iife'], platform: 'browser', target: 'es2020', bundle: true, noExternal: ['@lightback/core'], silent: true, config: false });
  let browserConnection;
  app = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(dir, 'dist/app.global.js'))); return; }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>MCP feedback fixture</title><main style="padding:80px"><h1>Review the button</h1>${await readFile(source, 'utf8')}</main><script>window.connection=${JSON.stringify(browserConnection)}</script><script src="/app.js"></script>`);
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const config = makeConfig({ project: 'browser-fixture', session: 'review-session', origin, port });
  const { agentToken, version, origin: allowedOrigin, ...connection } = config;
  browserConnection = connection;
  const configFile = join(dir, 'connection.json'); writeConfig(configFile, config);
  receiver = await startReceiver(config);
  const connect = async () => {
    client = new Client({ name: 'browser-test-agent', version: '1.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('packages/mcp/dist/cli.js'), 'stdio', '--config', configFile], stderr: 'pipe' }));
  };
  await connect();
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args }); check(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const initial = await call('list_feedback');
  await page.goto(origin);
  await page.waitForSelector(W + '[data-action=pick]');
  await page.click(W + '[data-action=pick]');
  await page.click('[data-testid=target]');
  await page.waitForSelector(W + '[data-ref=popover]:not([hidden])');
  await page.keyboard.type('Please make this button blue');
  const waiting = call('wait_for_feedback', { cursor: initial.cursor, instance: initial.instance, timeoutMs: 10000 });
  await page.click(W + '[data-action=pop-send]');
  const submitted = (await waiting).reports[0];
  if (!submitted) {
    await page.screenshot({ path: OUT + 'failed-submission.png' });
    await writeFile(OUT + 'failed-payload.json', JSON.stringify(await page.evaluate(() => window.lastSubmittedPayload), null, 2));
  }
  check(submitted, 'browser report arrived');
  const context = await call('get_feedback', { reportId: submitted.id });
  assert(context.prompt.includes('Button.html:1:1'), 'MCP sees the actual selected frontend source');
  assert(context.prompt.includes('Please make this button blue'), 'MCP sees selection feedback');
  assert(context.attachments.length === 2, 'MCP sees screenshot and selected element crop');
  const image = await client.callTool({ name: 'get_feedback_image', arguments: { reportId: submitted.id, name: 'selection-1.png' } });
  assert(image.content.some(item => item.type === 'image' && item.mimeType === 'image/png'), 'MCP returns the crop as image content');
  await call('update_feedback', { reportId: submitted.id, expectedRevision: 1, messageId: 'claim', status: 'in_progress', text: 'Updating Button.html' });
  // Simulate the host's ordinary file edit, then verify the served result in a browser.
  await writeFile(source, (await readFile(source, 'utf8')).replace('rgb(180,30,30)', 'rgb(30,80,200)'));
  await page.reload();
  assert(await page.locator('[data-testid=target]').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(30, 80, 200)', 'edited frontend fixture renders the requested color after reload');
  await call('update_feedback', { reportId: submitted.id, expectedRevision: 2, messageId: 'done', status: 'resolved', text: 'Button is blue. Verified its computed style after reload. <img src=x onerror=alert(1)>' });
  const T = 'lightback-thread >> ';
  await page.click(T + '[data-action=toggle]');
  await page.waitForFunction(() => document.querySelector('lightback-thread').shadowRoot.querySelector('[data-ref=messages]').textContent.includes('Button is blue'));
  assert((await page.locator(T + '[data-ref=messages]').textContent()).includes('Please make this button blue'), 'thread displays the original selection comment');
  assert(await page.locator(T + '[data-ref=messages] img').count() === 0, 'agent replies render as text, never executable HTML');
  await page.screenshot({ path: OUT + '1-agent-reply.png' });
  await client.close(); await connect();
  // HTTP LAN origins expose getRandomValues but may omit randomUUID.
  await page.evaluate(() => Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined }));
  await page.fill(T + '[data-ref=note]', 'Please add more padding. PRIVATE_WORD');
  await page.click(T + '[data-action=follow-up]');
  await page.waitForFunction(() => document.querySelector('lightback-thread').shadowRoot.querySelector('[data-ref=note]').value === '');
  const followup = await call('get_feedback', { reportId: submitted.id });
  assert(followup.status === 'pending' && followup.revision === 4, 'follow-up reopens the same report after browser and agent reconnects');
  assert(followup.messages.at(-1).text.includes('[redacted]') && !followup.messages.at(-1).text.includes('PRIVATE_WORD'), 'follow-up uses host custom redaction');
  const network = await page.evaluate(() => window.testBridge.client.buildPayload({ text: 'check' }).network);
  assert(!network.some(n => n.url.includes('/v1/projects/')), 'bridge requests do not pollute captured network context');
  await page.screenshot({ path: OUT + '2-followup.png' });
  // Simulate the selected report expiring while another retained report remains.
  // The draft must stay attached to its original report, never move to the newer one.
  await page.evaluate(async () => {
    const { bridge, client } = window.testBridge;
    await bridge.send(client.buildPayload({ text: 'A different report' }), []);
    window.originalBridgeList = bridge.list;
    const selected = document.querySelector('lightback-thread').shadowRoot.querySelector('[data-ref=reports]').value;
    bridge.list = async () => { const list = await window.originalBridgeList(); return { ...list, reports: list.reports.filter(report => report.id !== selected) }; };
  });
  await page.fill(T + '[data-ref=note]', 'This draft belongs to the original report');
  await page.waitForFunction(() => document.querySelector('lightback-thread').shadowRoot.querySelector('[data-ref=status]').textContent.includes('unavailable'));
  assert(await page.inputValue(T + '[data-ref=reports]') === submitted.id, 'expiry keeps the original report selected');
  assert(await page.inputValue(T + '[data-ref=note]') === 'This draft belongs to the original report', 'expiry preserves the original draft');
  assert(await page.locator(T + '[data-action=follow-up]').isDisabled(), 'expired report cannot receive a follow-up');
  // Even a programmatic submit cannot route the draft to the remaining report.
  await page.locator(T + '[data-ref=form]').evaluate(form => form.requestSubmit());
  assert((await call('list_feedback')).reports.every(report => report.id === submitted.id || report.revision === 1), 'draft never reaches another report');
  await page.evaluate(() => { window.testBridge.bridge.list = window.originalBridgeList; });
  await page.waitForFunction(() => !document.querySelector('lightback-thread').shadowRoot.querySelector('[data-action=follow-up]').disabled);
  // Changing reports during an in-flight poll clears stale content and queues a fresh read.
  const otherId = (await call('list_feedback')).reports.find(report => report.id !== submitted.id).id;
  await page.evaluate(() => {
    const { bridge, thread } = window.testBridge;
    bridge.list = async () => {
      window.blockedPollStarted = true;
      await new Promise(resolve => { window.releasePoll = resolve; });
      return window.originalBridgeList();
    };
    void thread.refresh();
  });
  await page.waitForFunction(() => window.blockedPollStarted);
  await page.selectOption(T + '[data-ref=reports]', otherId);
  assert(await page.locator(T + '[data-ref=messages]').textContent() === '', 'switching reports clears stale messages during a pending poll');
  assert(await page.locator(T + '[data-action=follow-up]').isDisabled(), 'switching reports disables sending until the new report loads');
  await page.evaluate(() => { window.testBridge.bridge.list = window.originalBridgeList; window.releasePoll(); });
  await page.waitForFunction(() => document.querySelector('lightback-thread').shadowRoot.querySelector('[data-ref=messages]').textContent.includes('A different report'));
  assert(await page.inputValue(T + '[data-ref=reports]') === otherId, 'queued refresh loads the explicitly selected report');
  // Receiver failure keeps unsent text visible. A closed agent alone did not lose the queue above.
  await receiver.close();
  await page.fill(T + '[data-ref=note]', 'Keep this unsent follow-up');
  await page.click(T + '[data-action=follow-up]');
  await page.waitForFunction(() => document.querySelector('lightback-thread').shadowRoot.querySelector('[data-ref=error]').textContent.length > 0);
  assert(await page.inputValue(T + '[data-ref=note]') === 'Keep this unsent follow-up', 'receiver disconnect preserves unsent text and shows an error');
  assert((await page.evaluate(() => window.unhandledRejections)).length === 0, 'receiver disconnect causes no unhandled promise rejection');
  // WebKit reports the intentionally unreachable cross-origin request as a page error.
  // Match only this known failed follow-up; all other page errors remain failures.
  await finish([`/${new URL(config.url).host}/v1/projects/${encodeURIComponent(config.project)}/sessions/${encodeURIComponent(config.session)}/reports/${encodeURIComponent(otherId)}/messages due to access control checks.`]);
} finally {
  await client?.close(); await receiver?.close();
  if (app) await new Promise(resolve => { app.close(resolve); app.closeAllConnections(); });
  await browser.close(); await rm(dir, { recursive: true, force: true });
}
