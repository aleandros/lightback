import { describe, expect, it } from 'vitest';
import { transformSync } from '@babel/core';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { transformSource } from '../src';
import babelPlugin from '../src/babel';
import { sourceFilter } from '../src/shared';

describe('source transform', () => {
  it('stamps exact one-based opening positions without changing lines, and emits a usable map', () => {
    const code = 'const view = (\n  <section>\n    <button\n      disabled\n    />\n  </section>\n);';
    const result = transformSource(code, '/app/src/View.tsx', { root: '/app' })!;
    expect(result.code).toContain('data-source={"src/View.tsx:2:3"}');
    expect(result.code).toContain('data-source={"src/View.tsx:3:5"}');
    expect(result.map?.sources).toEqual(['View.tsx']);
    const line = result.code.split('\n')[2]!;
    expect(originalPositionFor(new TraceMap(JSON.stringify(result.map)), { line: 3, column: line.indexOf('button') })).toMatchObject({ source: 'View.tsx', line: 3, column: 5 });
    expect(result.code).not.toContain('/app/');
  });

  it('preserves explicit attributes, skips components/fragments/namespaces, stamps SVG and custom elements once', () => {
    const code = 'const view = <><Widget/><UI.Button/><svg><path/></svg><my-tag {...props}/><div data-source="manual:1:2"/><span data-lb-source="old:2:3"/><ns:tag/></>;';
    const result = transformSource(code, 'src/View.jsx', { root: '/app' })!;
    expect(result.code.match(/data-source=/g)).toHaveLength(4);
    expect(result.code).toMatch(/<my-tag \{\.\.\.props\} data-source=/);
    expect(result.code).toContain('data-source="manual:1:2"');
    expect(result.code).toContain('data-lb-source="old:2:3"');
    expect(transformSource(result.code, 'src/View.jsx', { root: '/app' })!.code).toBe(result.code);
  });

  it('applies relative include/exclude globs and never stamps dependencies or outside-root modules', () => {
    const options = { root: '/app', include: 'src/**/*.{jsx,tsx,js}', exclude: ['**/*.test.*', '**/generated/**'] };
    expect(transformSource('const x = <div/>', '/app/src/App.js', options)?.code).toContain('src/App.js:1:11');
    for (const id of ['/app/src/App.test.tsx', '/app/src/generated/App.tsx', '/app/node_modules/a/src/App.tsx', '/app/src/node_modules/App.tsx', '/other/App.tsx', '/app2/App.tsx', '/app/src/../../App.tsx', '\0virtual.tsx', '/app/src/App.tsx?raw', '/app/src/App.tsx#raw', '/app/src/App.vue', '/app/src/App.svelte']) {
      expect(transformSource('not even valid JSX', id, options), id).toBeNull();
    }
    expect(transformSource('const x = <div/>', '/app/src/App.js', { root: '/app' })).toBeNull();
    expect(transformSource('const x = <div/>', '/app/src/App.tsx', { root: '/app', include: [] })).toBeNull();
  });

  it('normalizes Windows filenames and rejects other drives', () => {
    const filter = sourceFilter({ root: 'C:\\work\\app' });
    expect(filter('C:\\work\\app\\src\\App.tsx')).toBe('src/App.tsx');
    expect(filter('D:\\work\\App.tsx')).toBeNull();
    expect(filter('C:\\work\\outside.tsx')).toBeNull();
    expect(transformSource('const x = <div/>', 'C:\\work\\app\\src\\App.tsx', { root: 'C:\\work\\app' })!.code).toContain('src/App.tsx:1:11');
  });

  it('stamps through Babel before production JSX/TypeScript compilation', () => {
    const result = transformSync('const label: string = "ok"; export const x = <button>{label}</button>;', {
      filename: '/app/src/App.tsx', babelrc: false, configFile: false,
      plugins: [[babelPlugin, { root: '/app' }], ['@babel/plugin-transform-typescript', { isTSX: true }], ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]],
    })!;
    expect(result.code).toContain('"data-source": "src/App.tsx:1:46"');
    expect(result.code).not.toContain(': string');
    expect(result.code).not.toContain('<button');
  });

  it('does not hide parse errors on supported files', () => {
    expect(() => transformSource('const x = <div>', '/app/src/App.tsx', { root: '/app' })).toThrow();
  });

  it('accepts configured decorators and TypeScript assertions without enabling JSX in .ts', () => {
    expect(transformSource('@observer class View { render() { return <div/>; } }', 'src/View.tsx', {
      root: '/app', parserPlugins: ['decorators-legacy'],
    })!.code).toContain('data-source=');
    expect(transformSource('const value = <string>input;', 'src/value.ts', {
      root: '/app', include: '**/*.ts',
    })!.code).toMatch(/<string>\s*input/);
  });

  it('preserves quotes and entity-like text in filenames through JSX lowering', () => {
    const file = 'src/a"&copy;b.tsx';
    const stamped = transformSource('const x = <div/>', file, { root: '/app' })!;
    const compiled = transformSync(stamped.code, {
      babelrc: false, configFile: false,
      plugins: [['@babel/plugin-transform-react-jsx', { pragma: 'tag' }]],
    })!;
    const props = new Function('tag', `${compiled.code}; return x;`)((_tag: string, attrs: unknown) => attrs);
    expect(props).toEqual({ 'data-source': `${file}:1:11` });
  });

  it('also stamps when the Babel plugin follows the JSX transform', () => {
    const result = transformSync('const x = <button/>;', {
      filename: '/app/src/App.jsx', babelrc: false, configFile: false,
      plugins: [['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }], [babelPlugin, { root: '/app' }]],
    })!;
    expect(result.code).toContain('"data-source": "src/App.jsx:1:11"');
  });
});
