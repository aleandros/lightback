import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startReceiver } from '../src/receiver';
import { writeConfig, readConfig } from '../src/config';
import { config, payload, png, appRequest, json } from './helpers';

it('runs the real stdio CLI: discovery, context, image, reply, reconnect and follow-up, without a model', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lightback-mcp-'));
  const file = join(dir, 'connection.json'); const c = await config(); writeConfig(file, c);
  const receiver = await startReceiver(c);
  let client = new Client({ name: 'lightback-test', version: '1.0.0' });
  const connect = async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'stdio', '--config', file], stderr: 'pipe' });
    await client.connect(transport);
    return transport;
  };
  try {
    await connect();
    expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(['get_feedback', 'get_feedback_image', 'list_feedback', 'update_feedback', 'wait_for_feedback']);
    const p = payload('Please change the selected button');
    p.attachments = [{ name: 'screenshot.png', type: 'image/png', size: png.length }];
    const form = new FormData(); form.append('payload', JSON.stringify(p)); form.append('screenshot.png', new Blob([png], { type: 'image/png' }), 'screenshot.png');
    const initial = await call('list_feedback');
    const waiting = call('wait_for_feedback', { cursor: initial.cursor, instance: initial.instance, timeoutMs: 2000 });
    expect((await appRequest(c, '/reports', { method: 'POST', body: form })).status).toBe(201);
    expect((await waiting).reports[0].id).toBe(p.id);
    const report = await call('get_feedback', { reportId: p.id });
    expect(report.prompt).toContain('Please change'); expect(report.untrusted).toBe(true);
    const image = await client.callTool({ name: 'get_feedback_image', arguments: { reportId: p.id, name: 'screenshot.png' } });
    expect(image.content).toContainEqual({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
    const update = { reportId: p.id, messageId: 'claim', expectedRevision: 1, status: 'in_progress', text: 'Working on the component' };
    expect((await call('update_feedback', update)).revision).toBe(2);
    await client.close();
    client = new Client({ name: 'reconnected-agent', version: '1.0.0' }); await connect();
    expect((await call('get_feedback', { reportId: p.id })).revision).toBe(2);
    expect((await call('update_feedback', { ...update, expectedRevision: 2, messageId: 'done', status: 'resolved', text: 'Changed and tested. Please review.' })).status).toBe('resolved');
    expect((await appRequest(c, `/reports/${p.id}/messages`, json({ messageId: 'followup', expectedRevision: 3, text: 'Use more padding' }))).status).toBe(200);
    expect((await call('get_feedback', { reportId: p.id })).status).toBe('pending');
    const raw = await call('get_feedback', { reportId: p.id, format: 'json' });
    expect(JSON.parse(raw.data).messages.at(-1).text).toBe('Use more padding');
    expect((await client.callTool({ name: 'update_feedback', arguments: { ...update, messageId: 'stale' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'get_feedback', arguments: { reportId: 'missing' } })).isError).toBe(true);
    // Core may redact a numeric UUID segment; IDs remain opaque and round-trip through URLs.
    for (const id of ['[redacted]-8123-abcd', 'report/with?query#fragment']) {
      const opaque = { ...payload('Opaque report ID'), id };
      expect((await appRequest(c, '/reports', json(opaque))).status).toBe(201);
      expect((await call('get_feedback', { reportId: id })).id).toBe(id);
      expect((await call('update_feedback', { reportId: id, messageId: 'opaque-reply', expectedRevision: 1, status: 'resolved', text: 'Reviewed' })).id).toBe(id);
    }
    for (const oversized of [Buffer.from(png), Buffer.alloc(3_750_001)]) {
      if (oversized.length === png.length) oversized.writeUInt32BE(8001, 16);
      else png.copy(oversized);
      const largeImage = payload('Use text if image delivery exceeds host limits');
      largeImage.attachments = [{ name: 'large.png', type: 'image/png', size: oversized.length }];
      receiver.store.submit(largeImage, new Map([['large.png', oversized]]));
      const rejected = await client.callTool({ name: 'get_feedback_image', arguments: { reportId: largeImage.id, name: 'large.png' } });
      expect(rejected.isError).toBe(true);
      expect((rejected.content as { type: string }[]).every(item => item.type === 'text')).toBe(true);
      expect((await call('get_feedback', { reportId: largeImage.id })).prompt).toContain('Use text');
    }
    // A status change shifts JSON offsets: stale chunks must never be silently concatenated.
    const large = payload('x'.repeat(50_000));
    expect((await appRequest(c, '/reports', json(large))).status).toBe(201);
    const first = await call('get_feedback', { reportId: large.id, format: 'json' });
    expect(first.nextOffset).toBe(32_000);
    const pageArgs = { reportId: large.id, format: 'json', offset: first.nextOffset };
    expect((await client.callTool({ name: 'get_feedback', arguments: pageArgs })).isError).toBe(true);
    await call('update_feedback', { reportId: large.id, messageId: 'large-claim', expectedRevision: 1, status: 'in_progress', text: 'Working' });
    expect((await client.callTool({ name: 'get_feedback', arguments: { ...pageArgs, expectedRevision: first.revision } })).isError).toBe(true);
    let next = await call('get_feedback', { reportId: large.id, format: 'json' });
    let complete = next.data;
    while (next.nextOffset !== null) {
      next = await call('get_feedback', { reportId: large.id, format: 'json', offset: next.nextOffset, expectedRevision: next.revision });
      complete += next.data;
    }
    expect(JSON.parse(complete).payload.note.text).toBe(large.note.text);
    expect(JSON.parse(complete).status).toBe('in_progress');
    await receiver.close();
    expect((await client.callTool({ name: 'list_feedback', arguments: {} })).isError).toBe(true);
  } finally { await client.close(); await receiver.close(); await rm(dir, { recursive: true, force: true }); }
  async function call(name: string, args = {}): Promise<any> {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as { text: string }[])[0]!.text);
  }
}, 20_000);

it('refuses unsafe config URLs, broad origins, duplicate credentials and readable private files', async () => {
  const c = await config();
  const dir = await mkdtemp(join(tmpdir(), 'lightback-config-'));
  const file = join(dir, 'connection.json');
  try {
    expect(() => writeConfig(file, { ...c, url: 'http://evil.test:4318' })).toThrow();
    expect(() => writeConfig(file, { ...c, origin: '*' })).toThrow();
    expect(() => writeConfig(file, { ...c, agentToken: c.token })).toThrow();
    writeConfig(file, c); expect(readConfig(file)).toEqual(c);
    const browser = JSON.parse(execFileSync(process.execPath, [resolve('dist/cli.js'), 'browser-config', '--config', file], { encoding: 'utf8' }));
    expect(browser).toEqual({ url: c.url, project: c.project, session: c.session, token: c.token });
    expect(JSON.stringify(browser)).not.toContain(c.agentToken);
    expect(() => writeConfig(file, c)).toThrow();
    if (process.platform !== 'win32') { await chmod(file, 0o644); expect(() => readConfig(file)).toThrow('chmod 600'); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
