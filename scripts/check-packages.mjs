// Validate the actual publish artifacts, outside the workspace and its aliases.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { runInNewContext } from 'node:vm';

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
    assert.equal(typeof react.LightbackProvider, 'function');
    assert.equal(typeof react.useLightback, 'function');
  `;
  for (const mode of ['esm', 'cjs']) {
    const file = join(scratch, mode === 'esm' ? 'smoke.mjs' : 'smoke.cjs');
    const imports = mode === 'esm'
      ? `import assert from 'node:assert/strict'; import * as core from '@lightback/core'; import * as widget from '@lightback/widget'; import * as react from '@lightback/react';`
      : `const assert = require('node:assert/strict'); const core = require('@lightback/core'); const widget = require('@lightback/widget'); const react = require('@lightback/react');`;
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
  console.log('Packed ESM, CommonJS, standalone bundle, metadata and type resolution passed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
