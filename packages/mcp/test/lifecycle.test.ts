import { it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readConfig, writeConfig } from '../src/config';
import * as configuration from '../src/config';
import { scopePath } from '../src/types';
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
}, 60_000);

it('releases an obsolete managed receiver when its config is regenerated, even with browser polling', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lightback-reconfigure-'));
  const file = join(dir, 'connection.json');
  const c = await config();
  writeConfig(file, c);
  const receiver = await startReceiver(c, { configFile: file });
  const closed = once(receiver.server, 'close');
  const next = { ...c, session: 'replacement', token: c.agentToken, agentToken: c.token };
  const client = new Client({ name: 'regenerated-config-test', version: '1' });
  try {
    await rm(file);
    writeConfig(file, next);
    // The config watcher may close the socket before the request reaches it.
    const response = await appRequest(c, '/reports').catch(error => {
      expect(['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET']).toContain(error.cause?.code);
      return undefined;
    });
    if (response) expect(response.status).toBe(503);
    await closed;
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'stdio', '--config', file], stderr: 'pipe' }));
    expect(await receiverRunning(next)).toBe(true);
    expect((await appRequest(next, '/reports', json(payload('New session')))).status).toBe(201);
  } finally {
    await client.close();
    await receiver.close();
    try { await stopReceiver(next); } finally { await rm(dir, { recursive: true, force: true }); }
  }
}, 30_000);

it('releases a managed receiver after its config is removed without any requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lightback-config-removed-'));
  const file = join(dir, 'connection.json');
  const c = await config();
  writeConfig(file, c);
  const receiver = await startReceiver(c, { configFile: file });
  const closed = once(receiver.server, 'close');
  try { await rm(file); await closed; }
  finally { await receiver.close(); await rm(dir, { recursive: true, force: true }); }
});

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

it('grants a fresh idle window after sleep or a stalled event loop instead of closing on wake', async () => {
  const c = await config();
  const receiver = await startReceiver(c, { idleTimeoutMs: 500 });
  const closed = once(receiver.server, 'close');
  const now = performance.now.bind(performance);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now() + 60_000);
  try {
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(receiver.server.listening).toBe(true);
    await closed;
  } finally { clock.mockRestore(); await receiver.close(); }
});

it('does not expire the receiver when the wall clock jumps forward', async () => {
  const c = await config();
  const receiver = await startReceiver(c, { idleTimeoutMs: 400 });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60_000);
  const release = keepReceiverAlive(c, 25);
  try {
    await new Promise(resolve => setTimeout(resolve, 550));
    expect(receiver.server.listening).toBe(true);
  } finally { clock.mockRestore(); release(); await receiver.close(); }
});

it('keeps lifecycle routes available when all request slots are occupied', async () => {
  const c = await config();
  const receiver = await startReceiver(c);
  let count = 0;
  const saturated = new Promise<void>(resolve => receiver.server.on('request', () => { if (++count === 24) resolve(); }));
  const requests = Array.from({ length: 24 }, () => {
    const req = request(c.url + scopePath(c) + '/agent/reports/pending/update', {
      method: 'POST', headers: { authorization: `Bearer ${c.agentToken}`, 'content-type': 'application/json', 'content-length': '100' },
    });
    req.on('error', () => {});
    req.write('{');
    return req;
  });
  try {
    await saturated;
    expect((await agentRequest(c, '/reports')).status).toBe(429);
    expect(await receiverRunning(c)).toBe(true);
    expect(await stopReceiver(c)).toBe(true);
  } finally { requests.forEach(req => req.destroy()); await receiver.close(); }
});

it('preserves queued reports across a temporary config read failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lightback-config-busy-'));
  const file = join(dir, 'connection.json');
  const c = await config();
  writeConfig(file, c);
  const receiver = await startReceiver(c, { configFile: file });
  const p = payload('Keep this report');
  try {
    expect((await appRequest(c, '/reports', json(p))).status).toBe(201);
    const reader = vi.spyOn(configuration, 'readConfig').mockImplementationOnce(() => { throw Object.assign(new Error('File busy'), { code: 'EBUSY' }); });
    try { expect(await receiverRunning(c)).toBe(true); } finally { reader.mockRestore(); }
    const response = await agentRequest(c, '/reports');
    expect((await response.json()).reports[0].id).toBe(p.id);
  } finally { await receiver.close(); await rm(dir, { recursive: true, force: true }); }
});
