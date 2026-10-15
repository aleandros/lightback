import { describe, expect, it, vi } from 'vitest';
import type { NextConfig } from 'next';
import { withLightbackSource } from '../src/next';
import loader, { type SourceLoaderContext } from '../src/loader';
import type { SourceOptions } from '../src/shared';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';

const context = { defaultConfig: {} };
const webpackContext = {} as Parameters<NonNullable<NextConfig['webpack']>>[1];

describe('Next config wrapper', () => {
  it('prepends stamping while preserving the order and values of every overlapping host rule', () => {
    const tail = { loaders: ['tail-loader'], condition: 'browser' as const };
    const jsx = { loaders: ['jsx-loader'], as: '*.js' };
    const original: NextConfig = {
      reactStrictMode: true,
      turbopack: { resolveAlias: { old: 'new' }, rules: {
        '**/*.tsx': { loaders: ['overlapping-loader'] },
        '*.tsx': ['first-loader', { loader: 'second-loader', options: { flag: true } }, tail],
        '*.jsx': jsx,
        '*.svg': ['svg-loader'],
      } },
    };
    const before = structuredClone(original);
    const result = withLightbackSource(original);
    expect(original).toEqual(before);
    expect(result.reactStrictMode).toBe(true);
    expect(result.turbopack?.resolveAlias).toEqual({ old: 'new' });
    const rules = result.turbopack!.rules!;
    expect(Object.keys(rules)).toEqual(['*.{tsx,jsx}', '**/*.tsx', '*.tsx', '*.jsx', '*.svg']);
    expect(rules['*.{tsx,jsx}']).toMatchObject({ loaders: [expect.objectContaining({ loader: expect.stringMatching(/[/\\]dist[/\\]loader\.cjs$/) })] });
    for (const [key, value] of Object.entries(original.turbopack!.rules!)) expect(rules[key]).toBe(value);
  });

  it('avoids combined-glob collisions without relocating or replacing host pipelines', () => {
    const rules = { '*.tsx': ['first'], '*.{tsx,jsx}': { loaders: ['second'] }, '*.{tsx,jsx,tsx}': ['third'] };
    const wrapped = withLightbackSource({ turbopack: { rules } }).turbopack!.rules!;
    expect(Object.keys(wrapped)).toEqual(['*.{tsx,jsx,tsx,tsx}', ...Object.keys(rules)]);
    for (const [key, value] of Object.entries(rules)) expect(wrapped[key]).toBe(value);
  });

  it('wraps sync/async config functions with the same phase/context and preserves sync results', async () => {
    const sync = vi.fn(() => ({ reactStrictMode: true }));
    const wrapped = withLightbackSource(sync);
    expect(wrapped('phase', context).reactStrictMode).toBe(true);
    expect(sync).toHaveBeenCalledWith('phase', context);
    const asyncConfig = withLightbackSource(async () => ({ output: 'standalone' }));
    expect((await asyncConfig('phase', context)).output).toBe('standalone');
  });

  it('runs the existing webpack hook before appending the first-executing pre loader, including async hooks', async () => {
    for (const asyncHook of [false, true]) {
      const pre = { enforce: 'pre', use: ['existing-loader'] };
      const hook = vi.fn((config) => {
        const result = { ...config, module: { rules: [pre] }, marker: true };
        return asyncHook ? Promise.resolve(result) : result;
      });
      const wrapped = withLightbackSource({ webpack: hook }, { exclude: '**/*.test.*' });
      const original = {};
      const result = await wrapped.webpack!(original, webpackContext);
      expect(hook).toHaveBeenCalledWith(original, webpackContext);
      expect(result.marker).toBe(true);
      expect(result.module.rules[0]).toBe(pre);
      const rule = result.module.rules[1];
      expect(rule.enforce).toBe('pre');
      expect(rule.test.test('/app/View.tsx')).toBe(true);
      expect(rule.test.test('/app/View.js')).toBe(false);
      expect(rule.exclude.test('C:\\app\\node_modules\\ui\\View.tsx')).toBe(true);
      expect(rule.use[0].options).toEqual({ exclude: '**/*.test.*' });
    }
  });

  it('dispatches custom include extensions and snapshots shared options for both compilers', () => {
    const options = { include: ['src/**/*.{js,tsx}'] };
    const config = withLightbackSource({}, options);
    options.include.push('**/*.test.tsx');
    expect(Object.keys(config.turbopack!.rules!)[0]).toContain('js,jsx');
    const rule = config.webpack!({}, webpackContext).module.rules[0];
    expect(rule.test.test('App.js')).toBe(true);
    expect(rule.use[0].options).toEqual({ include: ['src/**/*.{js,tsx}'] });
  });

  it('rejects non-JSON options before either compiler can silently drop values', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [/x/, () => {}, undefined, NaN, Infinity, 1n, new Date(), cycle, [undefined], Array(1), { [Symbol()]: true }]) {
      expect(() => withLightbackSource({}, { exclude: value } as SourceOptions)).toThrow(/withLightbackSource: options.exclude.*JSON/);
    }
    expect(() => withLightbackSource({}, { parserPlugins: [['decorators', { decoratorsBeforeExport: true }]] })).not.toThrow();
  });
});

function runLoader(code: string, overrides: Partial<SourceLoaderContext> = {}, map?: Parameters<typeof loader>[1]) {
  const callback = vi.fn();
  const cacheable = vi.fn();
  loader.call({ rootContext: '/app', resourcePath: '/app/src/View.tsx', getOptions: () => ({}), callback, cacheable, ...overrides }, code, map);
  expect(cacheable).toHaveBeenCalled();
  expect(callback).toHaveBeenCalledTimes(1);
  return callback.mock.calls[0]!;
}

describe('source loader', () => {
  it('defaults to the compiler root, returns original locations and a usable map, and respects explicit roots', () => {
    const code = 'export default () => (\n  <button>test</button>\n);';
    const [error, output, map] = runLoader(code);
    expect(error).toBeNull();
    expect(output).toContain('src/View.tsx:2:3');
    expect(map.file).toBe('View.tsx');
    expect(originalPositionFor(new TraceMap(map), { line: 2, column: output.split('\n')[1].indexOf('button') }))
      .toMatchObject({ source: 'View.tsx', line: 2, column: 3 });
    expect(runLoader(code, { getOptions: () => ({ root: '/app/src' }) })[1]).toContain('View.tsx:2:3');
  });

  it('keeps caches separate for the same options object used by different roots', () => {
    const options = {};
    expect(runLoader('const x = <div/>', { getOptions: () => options })[1]).toContain('src/View.tsx:1:11');
    expect(runLoader('const x = <div/>', { getOptions: () => options, rootContext: '/app/src' })[1]).toContain('"View.tsx:1:11"');
  });

  it('passes excluded and dependency modules and maps through unchanged', () => {
    const map = { version: 3, file: 'View.tsx', names: [], sources: ['original.tsx'], sourcesContent: ['source'], mappings: 'AAAA' };
    for (const resourcePath of ['/app/node_modules/ui/index.tsx', '/outside/View.tsx', '/app/View.js']) {
      const result = runLoader('untouched source', { resourcePath }, map);
      expect(result).toEqual([null, 'untouched source', map]);
      expect(result[2]).toBe(map);
    }
    expect(runLoader('raw source', { resourceQuery: '?raw' }, JSON.stringify(map)))
      .toEqual([null, 'raw source', JSON.stringify(map)]);
  });

  it('chains an upstream source map and reports parse errors through the callback', () => {
    const map = { version: 3, file: 'View.tsx', names: [], sources: ['original.tsx'], sourcesContent: ['\n\nconst x = <button/>;'], mappings: 'AAEA' };
    const [, , outputMap] = runLoader('const x = <button/>;', {}, map);
    expect(originalPositionFor(new TraceMap(outputMap), { line: 1, column: 0 }))
      .toMatchObject({ source: 'original.tsx', line: 3 });
    expect(runLoader('const x = <button>')[0]).toBeInstanceOf(Error);
  });

  it('carries requested maps across independent loader pipelines without publishing them when disabled', () => {
    const code = 'const x = <button/>;';
    const [, output, map] = runLoader(code, { sourceMap: true });
    const inline = JSON.parse(Buffer.from(output.split('base64,')[1], 'base64').toString());
    expect(inline).toEqual(map);
    expect(inline.sourcesContent).toEqual([code]);
    expect(runLoader(code, { sourceMap: false })[1]).not.toContain('sourceMappingURL');
    expect(runLoader(code, { sourceMap: true, resourcePath: '/app/node_modules/pkg/View.tsx' }))
      .toEqual([null, code, undefined]);
  });
});
