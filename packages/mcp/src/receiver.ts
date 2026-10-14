import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createLightback } from '@lightback/core';
import { ZodError } from 'zod';
import { validateConfig } from './config';
import { payloadSchema, messageSchema, updateSchema } from './schema';
import { BridgeError, ReportStore, type StoreOptions } from './store';
import { scopePath, type BridgeConfig } from './types';
import { configIdentity } from './lifecycle';
import { version } from '../package.json';

const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;
const redactor = createLightback({ persistence: false, capture: { console: false, errors: false, network: false, breadcrumbs: false } });
function matches(actual: string | undefined, expected: string) {
  if (!actual) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function parseJson(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  const queue: [unknown, number][] = [[value, 0]];
  while (queue.length) {
    const [item, depth] = queue.pop()!;
    if (depth > 32) throw new BridgeError(400, 'JSON nesting exceeds 32 levels');
    if (item && typeof item === 'object') for (const child of Object.values(item)) queue.push([child, depth + 1]);
  }
  return value;
}
async function body(req: IncomingMessage, limit: number) {
  if (Number(req.headers['content-length']) > limit) throw new BridgeError(413, 'Upload exceeds size limit');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new BridgeError(413, 'Upload exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function validPng(bytes: Buffer) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 32768 && height <= 32768 && width * height <= 40_000_000;
}
async function submission(req: IncomingMessage) {
  const contentType = req.headers['content-type'] ?? '';
  const multipart = contentType.startsWith('multipart/form-data;');
  if (!multipart && !/^application\/json(?:;|$)/i.test(contentType)) throw new BridgeError(415, 'Use application/json or multipart/form-data');
  const bytes = await body(req, multipart ? MAX_UPLOAD : MAX_JSON);
  const files = new Map<string, Buffer>();
  let raw: unknown;
  if (multipart) {
    const form = await new Request('http://localhost', { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(bytes) }).formData();
    if (form.getAll('payload').length !== 1 || typeof form.get('payload') !== 'string') throw new BridgeError(400, 'Exactly one payload field required');
    const json = form.get('payload') as string;
    if (Buffer.byteLength(json) > MAX_JSON) throw new BridgeError(413, 'Payload exceeds 1 MiB');
    raw = parseJson(json);
    for (const [name, file] of form) {
      if (name === 'payload') continue;
      if (typeof file === 'string' || files.has(name) || file.type !== 'image/png' || file.size > 5 * 1024 * 1024 || files.size >= 51) throw new BridgeError(400, 'Invalid or duplicate PNG attachment');
      const data = Buffer.from(await file.arrayBuffer());
      if (!validPng(data)) throw new BridgeError(400, 'Invalid PNG or image dimensions exceed limits');
      files.set(name, data);
    }
  } else raw = parseJson(bytes.toString('utf8'));
  // Validate without replacing the original object: preserve compatible v1 extension fields.
  payloadSchema.parse(raw);
  const payload = raw as import('@lightback/core').FeedbackPayload;
  const names = new Set<string>();
  for (const attachment of payload.attachments) {
    if (names.has(attachment.name) || attachment.name === 'payload' || files.get(attachment.name)?.length !== attachment.size) throw new BridgeError(400, 'Attachment metadata and files must match exactly');
    names.add(attachment.name);
  }
  if (names.size !== files.size || payload.selections.some(s => s.crop && !names.has(s.crop))) throw new BridgeError(400, 'Missing or unexpected attachment');
  return { payload, files };
}

/** One long-lived, in-memory queue per project/session. Agent transports never own its lifetime. */
export async function startReceiver(input: BridgeConfig, options: Omit<StoreOptions, 'project' | 'session'> & { idleTimeoutMs?: number } = {}) {
  if (options.idleTimeoutMs !== undefined && (!Number.isSafeInteger(options.idleTimeoutMs) || options.idleTimeoutMs < 1 || options.idleTimeoutMs > 2_147_483_647)) throw new Error('Invalid receiver idle timeout');
  const config = validateConfig(input);
  const store = new ReportStore({ ...options, project: config.project, session: config.session });
  const base = scopePath(config);
  let active = 0, uploads = 0;
  let lastActivity = Date.now();
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15_000, headersTimeout: 10_000 }, async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status: number, value: unknown) => { if (!res.destroyed) { res.statusCode = status; res.end(JSON.stringify(value)); } };
    let counted = false, uploading = false;
    try {
      if (req.headers.host !== new URL(config.url).host) throw new BridgeError(403, 'Invalid Host');
      const url = new URL(req.url ?? '/', config.url);
      if (url.origin !== config.url || !url.pathname.startsWith(base + '/')) throw new BridgeError(404, 'Unknown project/session');
      const path = url.pathname.slice(base.length);
      const agent = path.startsWith('/agent/');
      if (agent) {
        if (req.headers.origin || !matches(req.headers.authorization, `Bearer ${config.agentToken}`)) throw new BridgeError(403, 'Agent access denied');
      } else {
        if (req.headers.origin !== config.origin) throw new BridgeError(403, 'App origin denied');
        res.setHeader('Access-Control-Allow-Origin', config.origin);
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'content-type, x-lightback-token');
          res.setHeader('Access-Control-Allow-Private-Network', 'true');
          res.statusCode = 204; res.end(); return;
        }
        if (!matches(req.headers['x-lightback-token'] as string | undefined, config.token)) throw new BridgeError(403, 'App access denied');
      }
      if (active >= 24) throw new BridgeError(429, 'Too many active requests');
      active++; counted = true;
      lastActivity = Date.now();
      if (req.method === 'POST' && path === '/reports' && !agent) {
        if (uploads >= 4) throw new BridgeError(429, 'Too many concurrent uploads');
        uploads++; uploading = true;
      }
      const route = agent ? path.slice('/agent'.length) : path;
      if (agent && route === '/health' && req.method === 'GET') {
        return json(200, { name: 'lightback', version, config: configIdentity(config) });
      }
      if (agent && route === '/shutdown' && req.method === 'POST') {
        res.once('finish', () => { void close(); });
        return json(200, { stopped: true });
      }
      if (route === '/reports' && req.method === 'POST' && !agent) {
        const { payload, files } = await submission(req);
        return json(201, store.submit(payload, files));
      }
      if (route === '/reports' && req.method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? 0);
        const waitMs = Number(url.searchParams.get('wait') ?? 0);
        if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 25_000 || (!agent && waitMs)) throw new BridgeError(400, 'Invalid cursor or wait (maximum 25000 ms; agent only)');
        // A cursor from a restarted receiver must not hide all new reports.
        const cursor = url.searchParams.get('instance') === store.instance ? after : 0;
        const abort = new AbortController();
        const onClose = () => abort.abort();
        res.on('close', onClose);
        try { return json(200, waitMs ? await store.wait(cursor, waitMs, abort.signal) : store.list(cursor)); }
        finally { res.off('close', onClose); }
      }
      const match = /^\/reports\/([^/]+)(?:\/(messages|update|attachment))?$/.exec(route);
      if (!match) throw new BridgeError(404, 'Unknown route');
      const id = decodeURIComponent(match[1]!);
      if (!match[2] && req.method === 'GET') return json(200, store.get(id).report);
      if (match[2] === 'attachment' && req.method === 'GET' && agent) {
        const entry = store.get(id);
        const name = url.searchParams.get('name') ?? '';
        const data = entry.files.get(name);
        if (!data) throw new BridgeError(404, 'Attachment not found');
        return json(200, { name, mimeType: 'image/png', data: data.toString('base64') });
      }
      if (req.method === 'POST' && ((match[2] === 'messages' && !agent) || (match[2] === 'update' && agent))) {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new BridgeError(415, 'Use application/json');
        const raw = parseJson((await body(req, 40_000)).toString('utf8'));
        const message = agent ? updateSchema.parse(raw) : messageSchema.parse(raw);
        message.text = redactor.buildPayload({ text: message.text }).note.text;
        return json(200, store.message(id, message, agent ? 'agent' : 'reporter'));
      }
      throw new BridgeError(404, 'Unknown route');
    } catch (error) {
      const status = error instanceof BridgeError ? error.status : error instanceof ZodError || error instanceof SyntaxError || error instanceof TypeError ? 400 : 500;
      json(status, { error: error instanceof BridgeError ? error.message : status === 400 ? 'Invalid request data' : 'Bridge request failed' });
      if (!req.complete) {
        req.resume();
        const timer = setTimeout(() => req.destroy(), 1000); timer.unref();
        req.once('end', () => clearTimeout(timer));
      }
    } finally { if (counted) { active--; lastActivity = Date.now(); } if (uploading) uploads--; }
  });
  server.maxConnections = 64;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(new URL(config.url).port), '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const sweep = setInterval(() => store.prune(), 30_000); sweep.unref();
  let closing: Promise<void> | undefined;
  const idle = options.idleTimeoutMs === undefined ? undefined : setInterval(() => {
    if (!active && Date.now() - lastActivity >= options.idleTimeoutMs!) void close();
  }, Math.min(options.idleTimeoutMs, 30_000));
  idle?.unref();
  const close = () => closing ??= new Promise<void>((resolve, reject) => {
    clearInterval(sweep); clearInterval(idle);
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  });
  return { store, server, close };
}
