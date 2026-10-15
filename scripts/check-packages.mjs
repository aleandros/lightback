// Validate the actual publish artifacts, outside the workspace and its aliases.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'lightback-pack-'));
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });
try {
  run('pnpm', ['-r', '--filter', './packages/*', 'pack', '--pack-destination', scratch]);
  const tarballs = readdirSync(scratch).filter((name) => name.endsWith('.tgz')).map((name) => join(scratch, name));
  assert.equal(tarballs.length, 7);
  for (const tarball of tarballs) {
    // Svelte's runtime is ESM-only. Keep all other strict checks, and verify dynamic import below.
    const esmOnly = /lightback-svelte-/.test(tarball);
    run('pnpm', ['exec', 'attw', tarball, '--profile', 'strict', ...(esmOnly ? ['--ignore-rules', 'cjs-resolves-to-esm'] : [])]);
  }
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'lightback-pack-smoke', private: true }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs, 'react@18', '@types/react@18', 'vue@^3.5', 'svelte@^5', '@vue/compiler-sfc@^3.5', '@babel/preset-react@7', '@babel/preset-typescript@7'], scratch);
  const assertions = `
    const before = console.log;
    const client = core.createLightback();
    assert.equal(console.log, before);
    assert.equal(client.buildPayload({ text: 'packed' }).note.text, 'packed');
    client.destroy();
    assert.equal(typeof widget.mountWidget, 'function');
    assert.equal(widget.defaultStrings.send, 'Send');
    assert.throws(() => widget.mountWidget({ client }), /requires a browser DOM/);
    assert.equal(typeof lazy.mountLazyWidget, 'function');
    assert.throws(() => lazy.mountLazyWidget({ client }), /requires a browser DOM/);
    assert.equal(typeof react.LightbackProvider, 'function');
    assert.equal(typeof react.useLightback, 'function');
    assert.ok(source.transformSource('const x = <div/>', '/app/src/App.tsx', { root: '/app' }).code.includes('src/App.tsx:1:11'));
    assert.equal(typeof sourceVite.default, 'function');
    assert.equal(typeof sourceBabel.default, 'function');
    assert.equal(typeof vue.provideLightback, 'function');
    assert.equal(typeof svelte.provideLightback, 'function');
    assert.ok(sourceVue.transformVueSource('<template><button/></template>', '/app/App.vue', {root:'/app'}).code.includes('App.vue:1:11'));
    assert.ok(sourceSvelte.transformSvelteSource('<button/>', '/app/App.svelte', {root:'/app'}).code.includes('App.svelte:1:1'));
    assert.equal(typeof mcp.startReceiver, 'function');
    assert.equal(typeof bridge.createFeedbackBridge, 'function');
    assert.equal(typeof bridge.mountFeedbackThread, 'function');
  `;
  for (const mode of ['esm', 'cjs']) {
    const file = join(scratch, mode === 'esm' ? 'smoke.mjs' : 'smoke.cjs');
    const imports = mode === 'esm'
      ? `import assert from 'node:assert/strict'; import * as core from '@lightback/core'; import * as widget from '@lightback/widget'; import * as react from '@lightback/react'; import * as lazy from '@lightback/widget/lazy'; import * as vue from '@lightback/vue'; import * as svelte from '@lightback/svelte';`
      : `const assert = require('node:assert/strict'); const core = require('@lightback/core'); const widget = require('@lightback/widget'); const react = require('@lightback/react'); const lazy = require('@lightback/widget/lazy'); const vue = require('@lightback/vue'); const svelte = await import('@lightback/svelte');`;
    const sourceImports = mode === 'esm'
      ? `import * as source from '@lightback/source'; import * as sourceVite from '@lightback/source/vite'; import * as sourceBabel from '@lightback/source/babel'; import * as sourceVue from '@lightback/source/vue'; import * as sourceSvelte from '@lightback/source/svelte'; import * as mcp from '@lightback/mcp'; import * as bridge from '@lightback/mcp/browser';`
      : `const source = require('@lightback/source'); const sourceVite = require('@lightback/source/vite'); const sourceBabel = require('@lightback/source/babel'); const sourceVue = require('@lightback/source/vue'); const sourceSvelte = require('@lightback/source/svelte'); const mcp = require('@lightback/mcp'); const bridge = require('@lightback/mcp/browser');`;
    writeFileSync(file, mode === 'esm' ? imports + sourceImports + assertions : '(async () => {' + imports + sourceImports + assertions + '})().catch(error => { console.error(error); process.exitCode = 1; });');
    run(process.execPath, [file], scratch);
  }
  run(process.execPath, [join(scratch, 'node_modules/@lightback/mcp/dist/cli.js'), '--help'], scratch);
  for (const name of ['core', 'widget', 'react', 'source', 'vue', 'svelte', 'mcp']) {
    const dir = join(scratch, 'node_modules', '@lightback', name);
    assert.match(readFileSync(join(dir, 'LICENSE'), 'utf8'), /MIT License/);
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /Lightback/);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.ok(!JSON.stringify(manifest).includes('workspace:'));
  }
  writeFileSync(join(scratch, 'babel-smoke.cjs'), `
    const assert = require('node:assert/strict');
    const { transformSync } = require('@babel/core');
    const result = transformSync('export const x: unknown = <button/>;', {
      filename: require('node:path').join(__dirname, 'src/App.tsx'),
      babelrc: false, configFile: false,
      presets: ['@babel/preset-react', '@babel/preset-typescript'],
      plugins: [['@lightback/source/babel', { root: __dirname }]],
    });
    assert.ok(result.code.includes('src/App.tsx:1:27'));
    assert.ok(!result.code.includes('<button'));
  `);
  run(process.execPath, [join(scratch, 'babel-smoke.cjs')], scratch);
  const standalone = join(scratch, 'node_modules/@lightback/widget/dist/lightback.iife.js');
  const context = {};
  runInNewContext(readFileSync(standalone, 'utf8'), context);
  assert.deepEqual(Object.keys(context.Lightback).sort(), ['createLightback', 'defaultStrings', 'domCapturer', 'mountWidget']);
  context.Lightback.createLightback().destroy();
  const dist = dirname(standalone);
  const lazyScript = readFileSync(join(dist, 'lightback-lazy.iife.js'), 'utf8');
  const lazyContext = {};
  runInNewContext(lazyScript, lazyContext);
  assert.deepEqual(Object.keys(lazyContext.Lightback).sort(), ['createLightback', 'defaultStrings', 'domCapturer', 'mountLazyWidget']);
  assert.throws(() => lazyContext.Lightback.mountLazyWidget({ client: lazyContext.Lightback.createLightback() }), /requires a browser DOM/);
  const ui = readFileSync(join(dist, 'lightback-ui.js'), 'utf8');
  assert.ok(ui.includes('lb-panel'));
  assert.ok(!lazyScript.includes('lb-popover'));
  const eagerBytes = gzipSync(readFileSync(standalone)).length;
  const lazyBytes = gzipSync(lazyScript).length;
  assert.ok(lazyBytes < eagerBytes * 0.7, 'lazy standalone initial JS must be at least 30% smaller');
  console.log(`Standalone gzip: eager ${eagerBytes} B, lazy initial ${lazyBytes} B (${Math.round((1 - lazyBytes / eagerBytes) * 100)}% smaller); UI is a separate ${gzipSync(ui).length} B asset.`);
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test' });
  const previous = new Map();
  for (const name of ['window', 'document', 'navigator', 'screen', 'Element', 'HTMLElement', 'KeyboardEvent']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
  }
  try {
    const requirePacked = createRequire(join(scratch, 'package.json'));
    const { createLightback } = requirePacked('@lightback/core');
    const client = createLightback({ capture: { console: false, errors: false, network: false, breadcrumbs: false } });
    for (const lazy of [requirePacked('@lightback/widget/lazy'), await import(pathToFileURL(join(dist, 'lazy.js')).href)]) {
      const handle = lazy.mountLazyWidget({ client });
      assert.equal(handle.element.shadowRoot.querySelector('[data-ref=panel]'), null);
      await handle.open();
      assert.equal(handle.element.shadowRoot.querySelector('[data-ref=panel]').hidden, false);
      assert.equal(handle.element.shadowRoot.activeElement, handle.element.shadowRoot.querySelector('[data-ref=text]'));
      await handle.startPicking();
      const picker = handle.element.shadowRoot.querySelector('[data-ref=keyboardPicker]');
      assert.equal(handle.element.shadowRoot.activeElement, picker);
      picker.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
      assert.equal(handle.element.shadowRoot.querySelector('[data-ref=panel]').hidden, false);
      assert.equal(handle.element.shadowRoot.activeElement, handle.element.shadowRoot.querySelector('[data-ref=text]'));
      handle.element.shadowRoot.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
      assert.equal(handle.element.shadowRoot.querySelector('[data-ref=panel]').hidden, true);
      handle.destroy();
    }
    client.destroy();
  } finally {
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  // Current compilers are covered by production browser fixtures. Exercise declared minimum peers too.
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', 'vue@3.5.0', '@vue/compiler-sfc@3.5.0', 'svelte@5.0.0'], scratch);
  run(process.execPath, [join(scratch, 'smoke.mjs')], scratch);
  run(process.execPath, [join(scratch, 'smoke.cjs')], scratch);
  console.log('Packed ESM, CommonJS, standalone bundle, lazy activation, metadata and type resolution passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
