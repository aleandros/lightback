import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
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
  writeFileSync(path, JSON.stringify(validateConfig(config), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
