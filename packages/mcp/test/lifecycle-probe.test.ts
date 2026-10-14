import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { configIdentity, receiverRunning, stopReceiver } from '../src/lifecycle';
import { config } from './helpers';

it('retries reset or busy listeners and only stops an authenticated receiver with matching config', async () => {
  const c = await config();
  let mode = 'reset', shutdowns = 0;
  const server = createServer((req, res) => {
    if (mode === 'reset') { req.socket.destroy(); return; }
    if (req.url?.endsWith('/shutdown')) { shutdowns++; res.end('{}'); return; }
    if (mode === 'busy') { res.writeHead(429); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(mode === 'foreign' ? { name: 'another-service' } : { name: 'lightback', version: '0.0.0', config: configIdentity(c) }));
  });
  await new Promise<void>(resolve => server.listen(Number(new URL(c.url).port), '127.0.0.1', resolve));
  try {
    expect(await receiverRunning(c)).toBe(false);
    mode = 'busy'; expect(await receiverRunning(c)).toBe(false);
    mode = 'foreign';
    await expect(receiverRunning(c)).rejects.toThrow('occupied');
    await expect(stopReceiver(c)).rejects.toThrow('occupied');
    expect(shutdowns).toBe(0);
    mode = 'old-version';
    await expect(receiverRunning(c)).rejects.toThrow('version');
    expect(await stopReceiver(c)).toBe(true);
    expect(shutdowns).toBe(1);
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }
});
