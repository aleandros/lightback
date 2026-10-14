import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import lightbackSource from '../../packages/source/src/vite';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';

/**
 * Mock backend. Receives Lightback submissions at POST /api/feedback (JSON or multipart),
 * keeps them in memory, and exposes a few endpoints the demo app can hit to generate network noise.
 */
function mockApi(): Plugin {
  interface Submission {
    id: string;
    receivedAt: string;
    payload: Record<string, unknown> & { id: string };
    files: Record<string, string>;
  }
  const submissions: Submission[] = [];

  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  return {
    name: 'lightback-mock-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();
        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        try {
          if (url.pathname === '/api/feedback' && req.method === 'POST') {
            const buf = await readBody(req);
            const ct = req.headers['content-type'] ?? '';
            let payload: Submission['payload'] | undefined;
            const files: Record<string, string> = {};
            if (ct.includes('multipart/form-data')) {
              const form = await new Request('http://localhost/upload', { method: 'POST', headers: { 'content-type': ct }, body: new Uint8Array(buf).buffer as ArrayBuffer }).formData();
              for (const [name, value] of form.entries()) {
                if (typeof value === 'string') {
                  if (name === 'payload') payload = JSON.parse(value);
                } else {
                  const bytes = Buffer.from(await value.arrayBuffer());
                  files[name] = `data:${value.type || 'application/octet-stream'};base64,${bytes.toString('base64')}`;
                }
              }
            } else {
              payload = JSON.parse(buf.toString('utf8'));
            }
            if (!payload) return json(400, { error: 'missing payload' });
            const entry: Submission = { id: payload.id, receivedAt: new Date().toISOString(), payload, files };
            submissions.unshift(entry);
            server.ws.send({ type: 'custom', event: 'lightback:submission', data: { id: entry.id } });
            console.log(`[lightback] received submission ${entry.id} (${Object.keys(files).length} files, ${buf.length} bytes)`);
            return json(201, { id: entry.id });
          }
          if (url.pathname === '/api/feedback' && req.method === 'GET') return json(200, submissions);
          if (url.pathname === '/api/feedback' && req.method === 'DELETE') {
            submissions.length = 0;
            return json(200, { ok: true });
          }
          if (url.pathname === '/api/invoices') return json(200, { invoices: [{ id: 'INV-1042', total: 1280 }, { id: 'INV-1043', total: 90 }] });
          if (url.pathname === '/api/fail') return json(500, { error: 'Internal Server Error', detail: 'payments service unavailable (simulated)' });
          if (url.pathname === '/api/notfound') return json(404, { error: 'Not found' });
          if (url.pathname === '/api/slow') {
            await new Promise((r) => setTimeout(r, 1500));
            return json(200, { ok: true, slow: true });
          }
          if (url.pathname === '/api/echo') {
            const buf = await readBody(req);
            return json(200, { echoed: buf.toString('utf8') });
          }
          return json(404, { error: `no mock route for ${url.pathname}` });
        } catch (err) {
          return json(500, { error: String(err) });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/lightback/demo/' : '/',
  // Keep the demo's component chains readable in its production bundle.
  esbuild: { keepNames: mode === 'demo' },
  plugins: [lightbackSource(), react(), ...(mode === 'demo' ? [] : [mockApi()])],
  resolve: {
    alias: {
      '@lightback/mcp/browser': path.resolve(__dirname, '../../packages/mcp/src/browser.ts'),
      '@lightback/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@lightback/widget/lazy': path.resolve(__dirname, mode === 'demo' ? '../../packages/widget/dist/lazy.js' : '../../packages/widget/src/lazy.ts'),
      '@lightback/widget': path.resolve(__dirname, '../../packages/widget/src/index.ts'),
      '@lightback/react': path.resolve(__dirname, '../../packages/react/src/index.tsx'),
    },
  },
  server: { port: 5173 },
}));
