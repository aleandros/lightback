import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, linkSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { idSchema } from './schema';
import type { BridgeConfig } from './types';

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const configSchema = z.object({
  version: z.literal(1), url: z.string(), project: idSchema, session: idSchema,
  origin: z.string(), token, agentToken: token,
}).strict();
export function validateConfig(input: unknown): BridgeConfig {
  const config = configSchema.parse(input);
  const url = new URL(config.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.port) throw new Error('Bridge URL must be http://127.0.0.1:<port>');
  const origin = new URL(config.origin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.origin) throw new Error('Specify one exact HTTP(S) app origin, without a path or trailing slash');
  if (config.token === config.agentToken) throw new Error('Browser and agent credentials must differ');
  return { ...config, url: url.origin };
}
export function makeConfig(options: { project: string; origin: string; port?: number; session?: string }): BridgeConfig {
  return validateConfig({ version: 1, project: options.project, session: options.session ?? randomUUID(), origin: options.origin,
    url: `http://127.0.0.1:${options.port ?? 4318}`, token: randomBytes(32).toString('base64url'), agentToken: randomBytes(32).toString('base64url') });
}
export function readConfig(file: string): BridgeConfig {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 8192) throw new Error('Invalid bridge config file');
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('Bridge config contains credentials; use chmod 600 on it');
  return validateConfig(JSON.parse(readFileSync(file, 'utf8')));
}
export function writeConfig(file: string, config: BridgeConfig) {
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const data = JSON.stringify(validateConfig(config), null, 2) + '\n';
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
  try { linkSync(temporary, path); } // Atomic create-only publication on filesystems supporting links.
  catch (error) {
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    // Preserve exclusive creation and private permissions on filesystems without hard links.
    writeFileSync(path, data, { flag: 'wx', mode: 0o600 });
  }
  finally { unlinkSync(temporary); }
}

async function readReadyConfig(file: string) {
  const deadline = performance.now() + 1000;
  while (true) {
    try { return readConfig(file); }
    catch (error) {
      // An exclusive-write fallback may be in progress in another process. Never accept partial JSON.
      if (!(error instanceof SyntaxError) || performance.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}

export async function ensureConfig(file: string, options: { project?: string; origin?: string; port?: number; session?: string }) {
  let config: BridgeConfig;
  try { config = await readReadyConfig(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (!options.project || !options.origin) throw new Error('No Lightback config found. Run init first, or pass --project and --origin to stdio.');
    try { writeConfig(file, makeConfig({ ...options, project: options.project, origin: options.origin })); }
    catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError; }
    config = await readReadyConfig(file);
  }
  for (const key of ['project', 'origin', 'session'] as const) {
    if (options[key] !== undefined && options[key] !== config[key]) throw new Error(`--${key} differs from the existing config; use a separate --config file for another project/session.`);
  }
  if (options.port !== undefined && options.port !== Number(new URL(config.url).port)) throw new Error('--port differs from the existing config; use a separate --config file.');
  return config;
}
