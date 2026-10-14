import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);

export async function startReact19Fixture() {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./fixtures/', import.meta.url)),
    logLevel: 'error',
    resolve: { alias: [
      { find: /^react-dom(\/.*)?$/, replacement: `${path.dirname(require.resolve('react-dom19/package.json'))}$1` },
      { find: /^react(\/.*)?$/, replacement: `${path.dirname(require.resolve('react19/package.json'))}$1` },
    ] },
    esbuild: { jsx: 'automatic', jsxDev: true },
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await server.listen();
  return server;
}
