#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { ensureConfig, readConfig } from './config';
import { startReceiver } from './receiver';
import { serveMcp } from './mcp';
import { ensureReceiver, keepReceiverAlive, RECEIVER_IDLE_MS, stopReceiver } from './lifecycle';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string', default: '.lightback/connection.json' },
    project: { type: 'string' }, session: { type: 'string' }, origin: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean' },
    managed: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) {
    console.log(`Lightback local feedback bridge (Node 22+)\n\nlightback-mcp init --project my-app --origin http://localhost:5173 [--port 4318] [--session name] [--config file]\nlightback-mcp stdio --config /absolute/path/to/connection.json [--project my-app --origin http://localhost:5173]\nlightback-mcp browser-config [--config file]\nlightback-mcp stop [--config file]\nlightback-mcp serve [--config file]\n\nstdio automatically starts or reuses the local receiver; no extra server terminal needed.\nPass --project and --origin to create missing credentials on first connection.\ninit creates private credentials once and reuses matching configuration; add .lightback/ to .gitignore.\nThe background receiver survives agent reconnects and exits after 30 minutes without authenticated activity.\nstop clears its in-memory reports; serve runs it manually for diagnostics.\nbrowser-config prints ONLY the browser connection; never import connection.json in an app.\n`); return;
  }
  const file = resolve(values.config!);
  const command = positionals[0];
  if (positionals.length !== 1) throw new Error('Expected one command; use --help');
  if (command === 'init') {
    setup();
    console.error(`Ready: ${file}. Keep .lightback/ gitignored. Register stdio with your coding host; it starts the receiver automatically. Use browser-config for the app connection.`); return;
  }
  if (command === 'browser-config') {
    const { url, project, session, token } = readConfig(file);
    console.log(JSON.stringify({ url, project, session, token }, null, 2)); return;
  }
  if (command === 'serve') {
    const config = readConfig(file);
    const receiver = await startReceiver(config, values.managed ? { idleTimeoutMs: RECEIVER_IDLE_MS } : {});
    console.error(`Lightback receiver ${config.url} — project ${config.project}, session ${config.session}; app origin ${config.origin}. Reports expire after 30 minutes; stopping loses the queue.`);
    const stop = () => { void receiver.close().then(() => process.exit(0)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  if (command === 'stop') {
    console.error(await stopReceiver(readConfig(file)) ? 'Lightback receiver stopped; queued reports cleared.' : 'Lightback receiver is not running.'); return;
  }
  if (command === 'stdio') {
    const config = setup();
    await ensureReceiver(config, file, resolve(process.argv[1]!));
    const server = await serveMcp(file);
    const release = keepReceiverAlive(config);
    const onclose = server.server.onclose;
    server.server.onclose = () => { release(); onclose?.(); };
    return;
  }
  throw new Error('Unknown command; use --help');

  function setup() {
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid port');
    return ensureConfig(file, { project: values.project, origin: values.origin, session: values.session, port });
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Lightback failed'); process.exitCode = 1; });
