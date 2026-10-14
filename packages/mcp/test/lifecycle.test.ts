import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readConfig } from '../src/config';
import { keepReceiverAlive, receiverRunning, stopReceiver } from '../src/lifecycle';
import { startReceiver } from '../src/receiver';
import { config, payload, appRequest, agentRequest, json } from './helpers';

const exec = promisify(execFile);
const cli = resolve('dist/cli.js');

it('creates one private config and receiver on concurrent stdio starts, preserves reports on reconnect, and stops explicitly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lightback-startup-'));
  const file = join(dir, 'connection.json');
  const c = await config();
  const args = ['stdio', '--config', file, '--project', c.project, '--origin', c.origin, '--port', new URL(c.url).port];
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({ name: 'automatic-start-test', version: '1' }); clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, ...args], stderr: 'pipe' }));
    return client;
  };
  const list = async (client: Client) => {
    const result = await client.callTool({ name: 'list_feedback', arguments: {} });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as { text: string }[])[0]!.text);
  };
  try {
    const [first, second] = await Promise.all([connect(), connect()]);
    const saved = readConfig(file);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await list(first)).instance).toBe((await list(second)).instance);
    const initial = await list(first);
    const p = payload('Automatically started receiver');
    expect((await appRequest(saved, '/reports', json(p))).status).toBe(201);
    await Promise.all(clients.splice(0).map(client => client.close()));
    expect(await receiverRunning(saved)).toBe(true);
    const reconnected = await connect();
    const retained = await list(reconnected);
    expect(retained.instance).toBe(initial.instance);
    expect(retained.reports[0].id).toBe(p.id);
    // Re-running setup must reuse both credentials and session, never redirect a running frontend.
    await exec(process.execPath, [cli, 'init', ...args.slice(1)]);
    expect(readConfig(file)).toEqual(saved);
    await expect(exec(process.execPath, [cli, 'init', '--config', file, '--project', 'different'])).rejects.toThrow();
    expect(readConfig(file)).toEqual(saved);
    await Promise.all(clients.splice(0).map(client => client.close()));
    await exec(process.execPath, [cli, 'stop', '--config', file]);
    expect(await receiverRunning(saved)).toBe(false);
    const restarted = await list(await connect());
    expect(restarted.instance).not.toBe(initial.instance);
    expect(restarted.reports).toEqual([]);
  } finally {
    await Promise.all(clients.map(client => client.close()));
    try { await stopReceiver(readConfig(file)); } finally { await rm(dir, { recursive: true, force: true }); }
  }
}, 20_000);

it('never reuses a receiver with different credentials or browser settings, and protects lifecycle routes from browsers', async () => {
  const c = await config();
  const receiver = await startReceiver(c);
  try {
    expect(await receiverRunning(c)).toBe(true);
    await expect(receiverRunning({ ...c, agentToken: c.token })).rejects.toThrow('occupied');
    await expect(receiverRunning({ ...c, origin: 'http://localhost:9999' })).rejects.toThrow('occupied');
    await expect(receiverRunning({ ...c, token: c.agentToken })).rejects.toThrow('occupied');
    expect((await appRequest(c, '/agent/shutdown', { method: 'POST', headers: { authorization: `Bearer ${c.agentToken}` } })).status).toBe(403);
    expect((await appRequest(c, '/shutdown', { method: 'POST' })).status).toBe(404);
    expect((await appRequest(c, '/agent/health')).status).toBe(403);
    expect((await agentRequest(c, '/health')).status).toBe(200);
    expect(await receiverRunning(c)).toBe(true);
  } finally { await receiver.close(); }
});

it('exits after inactivity but lets an authenticated long poll finish', async () => {
  const c = await config();
  const receiver = await startReceiver(c, { idleTimeoutMs: 100 });
  const closed = once(receiver.server, 'close');
  try {
    const response = await agentRequest(c, '/reports?wait=250');
    expect(response.status).toBe(200);
    expect(receiver.server.listening).toBe(true);
    await closed;
    expect(await receiverRunning(c)).toBe(false);
  } finally { await receiver.close(); }
});

it('keeps an idle coding connection usable, then releases the managed receiver when disconnected', async () => {
  const c = await config();
  const receiver = await startReceiver(c, { idleTimeoutMs: 200 });
  const closed = once(receiver.server, 'close');
  const release = keepReceiverAlive(c, 25);
  try {
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(receiver.server.listening).toBe(true);
    release();
    await closed;
    expect(await receiverRunning(c)).toBe(false);
  } finally { release(); await receiver.close(); }
});
