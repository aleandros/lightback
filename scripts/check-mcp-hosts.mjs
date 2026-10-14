// Optional installed-host smoke. Codex uses direct protocol calls; Claude uses a local API fixture.
// No paid inference: Claude uses the local API fixture; Codex never starts a model turn.
// Run after pnpm build with Codex and Claude Code on PATH.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import assert from 'node:assert/strict';
import { createLightback } from '../packages/core/dist/index.js';
import { makeConfig, writeConfig } from '../packages/mcp/dist/index.js';
const run = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'lightback-hosts-'));
const cli = fileURLToPath(new URL('../packages/mcp/dist/cli.js', import.meta.url));
const configFile = join(dir, 'connection.json');
let receiver, codex, modelFixture;
try {
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const config = makeConfig({ project: 'host-smoke', session: 'test', origin: 'http://localhost:5173', port });
  writeConfig(configFile, config);
  receiver = { close: () => run(process.execPath, [cli, 'stop', '--config', configFile]) };
  const base = `${config.url}/v1/projects/${config.project}/sessions/${config.session}`;
  const readReport = async id => {
    const response = await fetch(`${base}/agent/reports/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${config.agentToken}`, connection: 'close' } });
    assert.equal(response.status, 200); return response.json();
  };
  const core = createLightback({ persistence: false });
  const payload = core.buildPayload({ text: 'Host protocol smoke: selected button feedback' }); core.destroy();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
  payload.attachments = [{ name: 'screenshot.png', type: 'image/png', size: png.length }];
  const submit = async () => {
    const form = new FormData(); form.append('payload', JSON.stringify(payload));
    form.append('screenshot.png', new Blob([png], { type: 'image/png' }), 'screenshot.png');
    const response = await fetch(base + '/reports', { method: 'POST', body: form, headers: { origin: config.origin, 'x-lightback-token': config.token, connection: 'close' } });
    await response.arrayBuffer(); assert.equal(response.status, 201);
  };
  const commandArgs = [cli, 'stdio', '--config', configFile];
  console.log((await run('codex', ['--version'])).stdout.trim());
  // Config tables merge, so disable every existing entry explicitly for this process.
  // Reading the inventory does not start servers, and none of its credentials are logged.
  const existing = JSON.parse((await run('codex', ['mcp', 'list', '--json'], { cwd: dir })).stdout);
  const serverName = 'lightback_smoke_' + process.pid;
  const isolatedServers = Object.fromEntries(existing.map(server => [server.name, { enabled: false, command: process.execPath, args: [] }]));
  isolatedServers[serverName] = { enabled: true, command: process.execPath, args: commandArgs };
  const disabled = existing.map(server => `${JSON.stringify(server.name)}={enabled=false,command=${JSON.stringify(process.execPath)},args=[]}`);
  const mcpConfig = `mcp_servers={${[...disabled, `${serverName}={enabled=true,command=${JSON.stringify(process.execPath)},args=${JSON.stringify(commandArgs)}}`].join(',')}}`;
  codex = spawn('codex', ['-c', mcpConfig, '-c', 'plugins={}', '-c', 'features.apps=false', '-c', 'analytics.enabled=false', 'app-server', '--stdio'], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', nextId = 0, stderr = '';
  const pending = new Map();
  codex.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-8000); });
  codex.on('exit', code => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`Codex exited (${code}): ${stderr}`)); } pending.clear(); });
  codex.stdout.on('data', bytes => {
    buffer += bytes;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n'); const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const entry = pending.get(message.id);
      if (entry && !message.method) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, 45000);
    pending.set(id, { resolve, reject, timer }); codex.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  await rpc('initialize', { clientInfo: { name: 'lightback_smoke', version: '1.0' }, capabilities: { experimentalApi: true } });
  codex.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const inventory = await rpc('mcpServerStatus/list', {});
  assert.deepEqual(inventory.data.filter(server => Object.keys(server.tools).length).map(server => server.name), [serverName], 'process config must isolate the smoke MCP server');
  assert.equal(Object.keys(inventory.data.find(s => s.name === serverName).tools).length, 5);
  console.log('Codex automatically started the receiver and discovered all five Lightback tools.');
  await submit();
  const thread = await rpc('thread/start', { cwd: dir, ephemeral: true, config: { mcp_servers: isolatedServers, plugins: {} } });
  const call = (tool, args = {}) => rpc('mcpServer/tool/call', { threadId: thread.thread.id, server: serverName, tool, arguments: args });
  const report = await call('get_feedback', { reportId: payload.id });
  assert(!report.isError, JSON.stringify(report)); assert(JSON.stringify(report).includes(payload.note.text));
  const image = await call('get_feedback_image', { reportId: payload.id, name: 'screenshot.png' });
  assert(JSON.stringify(image).includes(png.toString('base64')));
  const reply = await call('update_feedback', { reportId: payload.id, expectedRevision: 1, messageId: 'codex-reply', status: 'resolved', text: 'Codex protocol smoke complete' });
  assert(!reply.isError, JSON.stringify(reply));
  assert.equal((await readReport(payload.id)).status, 'resolved');
  console.log('Codex retrieved feedback and PNG content and posted a reply without starting a model turn.');
  codex.kill('SIGTERM'); codex = undefined;
  await receiver.close(); // Claude must independently start a missing receiver.

  const claudeEnv = { ...process.env, CLAUDE_CONFIG_DIR: join(dir, 'claude'), DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  console.log((await run('claude', ['--version'], { env: claudeEnv })).stdout.trim());
  await run('claude', ['mcp', 'add', '--scope', 'local', '--transport', 'stdio', 'lightback', '--', process.execPath, ...commandArgs], { cwd: dir, env: claudeEnv });
  const health = await run('claude', ['mcp', 'get', 'lightback'], { cwd: dir, env: claudeEnv, timeout: 45000 });
  assert.match(health.stdout, /Connected/i);
  console.log('Claude Code automatically started the receiver and connected to stdio.');
  await submit();
  // A deterministic local Messages API fixture drives the actual Claude Code tool loop.
  // It performs no inference and never forwards requests to a provider.
  const steps = [
    { name: 'list_feedback', input: {} },
    { name: 'get_feedback', input: { reportId: payload.id } },
    { name: 'get_feedback_image', input: { reportId: payload.id, name: 'screenshot.png' } },
    { name: 'update_feedback', input: { reportId: payload.id, expectedRevision: 1, messageId: 'claude-reply', status: 'resolved', text: 'Claude Code tool loop smoke complete' } },
  ];
  let step = 0;
  const observed = [];
  modelFixture = createHttpServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (req.url?.includes('count_tokens')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ input_tokens: 100 })); return; }
      if (!req.url?.includes('/messages')) { res.statusCode = 404; res.end(); return; }
      const previous = body.messages?.at(-1)?.content;
      if (Array.isArray(previous)) for (const block of previous) if (block.type === 'tool_result') observed.push(block);
      const next = steps[step];
      const tool = next && body.tools?.find(tool => tool.name.endsWith('__' + next.name));
      if (next && !tool) throw new Error('Claude did not advertise tool ' + next.name);
      step++;
      const block = next ? { type: 'tool_use', id: 'tool-' + step, name: tool.name, input: next.input } : { type: 'text', text: 'Local fixture completed the Lightback tool loop.' };
      const message = { id: 'msg-' + step, type: 'message', role: 'assistant', model: body.model, content: [block], stop_reason: next ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 30 } };
      if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(message)); return; }
      res.setHeader('content-type', 'text/event-stream');
      const event = (type, data) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n');
      event('message_start', { message: { ...message, content: [], stop_reason: null } });
      event('content_block_start', { index: 0, content_block: next ? { ...block, input: {} } : { type: 'text', text: '' } });
      event('content_block_delta', { index: 0, delta: next ? { type: 'input_json_delta', partial_json: JSON.stringify(next.input) } : { type: 'text_delta', text: block.text } });
      event('content_block_stop', { index: 0 });
      event('message_delta', { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 30 } });
      event('message_stop', {}); res.end();
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: { type: 'api_error', message: error.message } })); }
  });
  await new Promise(resolve => modelFixture.listen(0, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${modelFixture.address().port}`;
  const session = await run('claude', ['--bare', '--print', '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: { lightback: { command: process.execPath, args: commandArgs } } }), '--tools', '', '--allowedTools', 'mcp__lightback__*', '--max-turns', '8', '--model', 'claude-sonnet-4-6', 'Run the local Lightback protocol smoke.'], {
    cwd: dir, timeout: 60000, maxBuffer: 1024 * 1024,
    env: { ...claudeEnv, ANTHROPIC_BASE_URL: fixtureUrl, ANTHROPIC_API_KEY: 'lightback-local-fixture', ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ENABLE_TOOL_SEARCH: 'false' },
  });
  assert(step >= 5, session.stdout);
  assert.equal(observed.length, 4);
  assert(!observed.some(result => result.is_error), JSON.stringify(observed));
  assert(JSON.stringify(observed).includes(payload.note.text));
  assert(JSON.stringify(observed).includes(png.toString('base64')));
  assert.equal((await readReport(payload.id)).messages.at(-1).text, 'Claude Code tool loop smoke complete');
  console.log('Claude Code conversation retrieved feedback and PNG content and replied through MCP, driven by a local deterministic API fixture (no paid inference).');
} finally {
  codex?.kill('SIGTERM');
  if (modelFixture) await new Promise(resolve => { modelFixture.close(resolve); modelFixture.closeAllConnections(); });
  await receiver?.close(); await rm(dir, { recursive: true, force: true });
}
