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
  assert.equal(tarballs.length, 3);
  for (const tarball of tarballs) run('pnpm', ['exec', 'attw', '--profile', 'strict', tarball]);
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'lightback-pack-smoke', private: true }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs, 'react@18', '@types/react@18'], scratch);
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
  `;
  for (const mode of ['esm', 'cjs']) {
    const file = join(scratch, mode === 'esm' ? 'smoke.mjs' : 'smoke.cjs');
    const imports = mode === 'esm'
      ? `import assert from 'node:assert/strict'; import * as core from '@lightback/core'; import * as widget from '@lightback/widget'; import * as react from '@lightback/react'; import * as lazy from '@lightback/widget/lazy';`
      : `const assert = require('node:assert/strict'); const core = require('@lightback/core'); const widget = require('@lightback/widget'); const react = require('@lightback/react'); const lazy = require('@lightback/widget/lazy');`;
    writeFileSync(file, imports + assertions);
    run(process.execPath, [file], scratch);
  }
  for (const name of ['core', 'widget', 'react']) {
    const dir = join(scratch, 'node_modules', '@lightback', name);
    assert.match(readFileSync(join(dir, 'LICENSE'), 'utf8'), /MIT License/);
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /Lightback/);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.ok(!JSON.stringify(manifest).includes('workspace:'));
  }
  const standalone = join(scratch, 'node_modules/@lightback/widget/dist/lightback.iife.js');
  const context = {};
  runInNewContext(readFileSync(standalone, 'utf8'), context);
  assert.deepEqual(Object.keys(context.Lightback).sort(), ['createLightback', 'defaultStrings', 'mountWidget']);
  context.Lightback.createLightback().destroy();
  const dist = dirname(standalone);
  const lazyScript = readFileSync(join(dist, 'lightback-lazy.iife.js'), 'utf8');
  const lazyContext = {};
  runInNewContext(lazyScript, lazyContext);
  assert.deepEqual(Object.keys(lazyContext.Lightback).sort(), ['createLightback', 'defaultStrings', 'mountLazyWidget']);
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
  for (const name of ['window', 'document', 'navigator', 'screen', 'Element']) {
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
  console.log('Packed ESM, CommonJS, standalone bundle, lazy activation, metadata and type resolution passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
