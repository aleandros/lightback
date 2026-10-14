import { createServer } from 'node:net';
import { createLightback } from '@lightback/core';
import { makeConfig } from '../src/config';
import { scopePath, type BridgeConfig } from '../src/types';
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
export async function config(project = 'test-app', session = 'test-session') {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return makeConfig({ project, session, origin: 'http://localhost:5173', port });
}
export function payload(text = 'Make the button blue') {
  const client = createLightback({ persistence: false, capture: { console: false, errors: false, network: false, breadcrumbs: false } });
  const result = client.buildPayload({ text }); client.destroy(); return result;
}
export function appRequest(c: BridgeConfig, path: string, init: RequestInit = {}) {
  return fetch(c.url + scopePath(c) + path, { ...init, headers: { connection: 'close', origin: c.origin, 'x-lightback-token': c.token, ...init.headers } });
}
export function agentRequest(c: BridgeConfig, path: string, init: RequestInit = {}) {
  return fetch(c.url + scopePath(c) + '/agent' + path, { ...init, headers: { connection: 'close', authorization: `Bearer ${c.agentToken}`, ...init.headers } });
}
export const json = (value: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
