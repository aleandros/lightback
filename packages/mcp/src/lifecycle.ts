import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { version } from '../package.json';
import { scopePath, type BridgeConfig } from './types';

export const RECEIVER_IDLE_MS = 30 * 60_000;
export function configIdentity(config: BridgeConfig) {
  return createHash('sha256').update(JSON.stringify([config.url, config.project, config.session, config.origin, config.token, config.agentToken])).digest('hex');
}

/** Never mistake an occupied port, mismatched credentials or old receiver for an available port. */
export async function receiverRunning(config: BridgeConfig, requireVersion = true): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(config.url + scopePath(config) + '/agent/health', {
      headers: { authorization: `Bearer ${config.agentToken}`, connection: 'close' },
      signal: AbortSignal.timeout(1000), redirect: 'error',
    });
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED') return false;
    throw new Error(`Cannot contact the receiver at ${config.url}. Check the port and local network access.`, { cause: error });
  }
  const health = await response.json().catch(() => null) as { name?: string; version?: string; config?: string } | null;
  if (!response.ok || health?.name !== 'lightback' || (requireVersion && health.version !== version) || health.config !== configIdentity(config)) {
    throw new Error(`Port ${new URL(config.url).port} is occupied by a different receiver or version. Stop the previous receiver, or initialize this project with a different --port.`);
  }
  return true;
}

/** Detached lifetime preserves the queue when a coding host reconnects or closes stdio. */
export async function ensureReceiver(config: BridgeConfig, configFile: string, cliFile: string) {
  if (await receiverRunning(config)) return;
  const child = spawn(process.execPath, [cliFile, 'serve', '--managed', '--config', configFile], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  child.unref();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error('Could not start the Lightback receiver', { cause: spawnError });
    if (await receiverRunning(config)) return;
    // Concurrent starts are safe: the bind winner owns the queue; the loser exits.
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Receiver did not start at ${config.url}. Run lightback-mcp serve --config ${JSON.stringify(configFile)} to see the error.`);
}

export async function stopReceiver(config: BridgeConfig) {
  if (!await receiverRunning(config, false)) return false;
  const response = await fetch(config.url + scopePath(config) + '/agent/shutdown', {
    method: 'POST', headers: { authorization: `Bearer ${config.agentToken}`, connection: 'close' },
    signal: AbortSignal.timeout(3000), redirect: 'error',
  });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`Receiver refused shutdown (${response.status})`);
  return true;
}

/** An open MCP connection should stay usable even while the model is doing other work. */
export function keepReceiverAlive(config: BridgeConfig, intervalMs = 60_000) {
  const timer = setInterval(() => {
    // A deliberate stop is not undone. Reconnect stdio to start a missing receiver.
    void receiverRunning(config).catch(() => {});
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
