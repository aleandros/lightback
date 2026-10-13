import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { JSDOM, VirtualConsole } from 'jsdom';
import { expect, it } from 'vitest';
import lightbackSource from '../src/vite';
import { frameworkInfo } from '../../core/src/inspect';

const root = fileURLToPath(new URL('./fixtures/', import.meta.url));

it('builds minified JSX/TSX client and SSR fixtures with matching stamps and hydrates without errors', async () => {
  const compile = async (ssr: boolean) => {
    const result = await build({
      configFile: false, root, logLevel: 'silent', plugins: [lightbackSource()],
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        write: false, minify: true, sourcemap: true,
        ...(ssr ? { ssr: path.join(root, 'entry.tsx') } : {}),
        lib: { entry: path.join(root, 'entry.tsx'), name: 'Fixture', formats: [ssr ? 'cjs' : 'iife'] },
      },
    });
    const bundle = Array.isArray(result) ? result[0]! : result;
    if (!('output' in bundle)) throw new Error('Expected a bundle');
    const entry = bundle.output.find((chunk) => chunk.type === 'chunk' && chunk.isEntry)!;
    if (entry.type !== 'chunk') throw new Error('Expected an entry chunk');
    const offset = entry.code.indexOf('"data-testid":"button"');
    expect(offset).toBeGreaterThan(-1);
    const before = entry.code.slice(0, offset).split('\n');
    const location = originalPositionFor(new TraceMap(JSON.stringify(entry.map)), { line: before.length, column: before[before.length - 1]!.length });
    expect(location.source).toMatch(/App\.tsx$/);
    expect(location.line).toBe(7);
    return bundle.output.filter((chunk) => chunk.type === 'chunk').map((chunk) => chunk.code).join('\n');
  };
  const server = await compile(true);
  const client = await compile(false);
  for (const code of [server, client]) {
    expect(code).toContain('App.tsx:7:7');
    expect(code).toContain('Badge.jsx:4:10');
    expect(code).not.toContain(root);
    expect(code.includes('_debugSource')).toBe(false);
  }
  const exports: { render?: () => string } = {};
  const require = createRequire(import.meta.url);
  new Function('require', 'exports', 'module', server)(require, exports, { exports });
  const html = exports.render!();
  const errors: unknown[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(`<div id="root">${html}</div>`, { runScripts: 'outside-only', virtualConsole });
  try {
    Object.assign(dom.window, { TextEncoder, TextDecoder });
    const container = dom.window.document.querySelector('#root')!;
    const originalButton = container.querySelector('button')!;
    dom.window.eval(client);
    const fixture = (dom.window as unknown as { Fixture: { hydrate: (el: Element, error: (e: unknown) => void) => { unmount(): void } } }).Fixture;
    const hydrated = fixture.hydrate(container, (error) => errors.push(error));
    // React's production hydration is scheduled; wait for its fiber to be attached.
    await expect.poll(() => Object.keys(originalButton).some((key) => key.startsWith('__reactFiber$'))).toBe(true);
    expect(container.querySelector('button')).toBe(originalButton);
    expect(container.innerHTML).toBe(html);
    expect(errors).toEqual([]);
    expect(frameworkInfo(originalButton, '[data-lightback-sensitive]', false).source).toEqual({ file: 'App.tsx', line: 7, column: 7 });
    expect(frameworkInfo(container.querySelector('[data-testid=badge]')!, '[data-lightback-sensitive]', false).source).toEqual({ file: 'Badge.jsx', line: 4, column: 10 });
    expect(readFileSync(path.join(root, 'App.tsx'), 'utf8').split('\n')[6]!.indexOf('<button') + 1).toBe(7);
    hydrated.unmount();
  } finally { dom.window.close(); }
}, 20000);

it('serves nested modules with source maps resolving to the original file URL', async () => {
  const server = await createServer({
    configFile: false, root: path.dirname(root.slice(0, -1)), logLevel: 'silent',
    plugins: [lightbackSource()],
    server: { middlewareMode: true, hmr: false, watch: null, preTransformRequests: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const result = await server.transformRequest('/fixtures/App.tsx');
    if (!result?.map || !('sources' in result.map)) throw new Error('Expected a source map');
    const sources = result.map.sources;
    expect(sources.map((source) => new URL(source!, 'http://localhost/fixtures/App.tsx').pathname)).toContain('/fixtures/App.tsx');
    expect(result!.code).toContain('fixtures/App.tsx:7:7');
  } finally { await server.close(); }
});
