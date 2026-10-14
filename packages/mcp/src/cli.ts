#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { makeConfig, readConfig, writeConfig } from './config';
import { startReceiver } from './receiver';
import { serveMcp } from './mcp';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string', default: '.lightback/connection.json' },
    project: { type: 'string' }, session: { type: 'string' }, origin: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) {
    console.log(`Lightback local feedback bridge (Node 22+)\n\nlightback-mcp init --project my-app --origin http://localhost:5173 [--port 4318] [--session name] [--config file]\nlightback-mcp serve [--config file]\nlightback-mcp stdio --config /absolute/path/to/connection.json\nlightback-mcp browser-config [--config file]\n\ninit writes private credentials once; add .lightback/ to .gitignore.\nserve owns an in-memory queue (30 minute retention); stopping it loses reports.\nbrowser-config prints ONLY the browser connection; never import connection.json in an app.\nstdio connects a coding agent to an already running receiver; no model calls.\n`); return;
  }
  const file = resolve(values.config!);
  const command = positionals[0];
  if (positionals.length !== 1) throw new Error('Expected one command; use --help');
  if (command === 'init') {
    if (!values.project || !values.origin) throw new Error('init requires --project and --origin');
    const port = Number(values.port ?? 4318);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    writeConfig(file, makeConfig({ project: values.project, origin: values.origin, port, session: values.session }));
    console.error(`Created ${file}. Keep this file private and gitignored. Run serve, then browser-config for the app connection.`); return;
  }
  if (command === 'browser-config') {
    const { url, project, session, token } = readConfig(file);
    console.log(JSON.stringify({ url, project, session, token }, null, 2)); return;
  }
  if (command === 'serve') {
    const config = readConfig(file);
    const receiver = await startReceiver(config);
    console.error(`Lightback receiver ${config.url} — project ${config.project}, session ${config.session}; app origin ${config.origin}. Reports expire after 30 minutes; stopping loses the queue.`);
    const stop = () => { void receiver.close().then(() => process.exit(0)); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  if (command === 'stdio') { await serveMcp(file); return; }
  throw new Error('Unknown command; use --help');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Lightback failed'); process.exitCode = 1; });
