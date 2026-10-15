// Installs packed artifacts into an isolated real Next app. NEXT_VERSION=16.0.0 tests the minimum peer.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launch, W } from './lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = join(root, 'packages/source/test/next');
const scratch = mkdtempSync(join(tmpdir(), 'lightback-next-'));
const requireSource = createRequire(join(root, 'packages/source/package.json'));
const { AnyMap, originalPositionFor } = requireSource('@jridgewell/trace-mapping');
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
const { page, assert, finish, OUT } = await launch('next-source');
let active;
let log = '';

function command(binary, args, cwd = scratch) {
  const child = spawn(binary, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { chunks.push(chunk); log += chunk; writeFileSync(join(OUT, 'next.log'), log); });
  child.on('error', (error) => chunks.push(Buffer.from(String(error))));
  const done = once(child, 'close').then(([code]) => {
    const output = Buffer.concat(chunks).toString();
    if (code !== 0 && code !== null && !child.killed) throw new Error(`${binary} ${args.join(' ')} failed (${code})\n${output}`);
    return output;
  });
  // Server failures are reported by readiness polling, with their complete logs.
  done.catch(() => {});
  return { child, done, output: () => Buffer.concat(chunks).toString() };
}

async function stop() {
  if (!active) return;
  const running = active;
  active = undefined;
  running.child.kill('SIGTERM');
  const timer = setTimeout(() => running.child.kill('SIGKILL'), 5000);
  try { await running.done; } finally { clearTimeout(timer); }
}

async function start(args) {
  // Port 0 lets Next choose a free port; read the URL it reports.
  active = command(process.execPath, ['node_modules/next/dist/bin/next', ...args, '--hostname', '127.0.0.1', '--port', '0']);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const url = active.output().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) {
      try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return url; } catch {}
    }
    if (active.child.exitCode !== null) throw new Error(active.output());
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Next did not start\n${active.output()}`);
}

function location(file, needle) {
  const code = readFileSync(join(fixture, file), 'utf8');
  const offset = code.indexOf(needle);
  if (offset < 0) throw new Error(`Missing fixture marker: ${needle}`);
  const prefix = code.slice(0, offset).split('\n');
  return { file, line: prefix.length, column: prefix.at(-1).length + 1 };
}
const expected = {
  html: location('app/layout.tsx', '<html'),
  body: location('app/layout.tsx', '<body'),
  '[data-testid=page]': location('app/page.tsx', '<main'),
  '[data-testid=client]': location('app/Counter.tsx', '<section'),
  '[data-action=increment]': location('app/Counter.tsx', '<button'),
  '[data-testid=badge]': location('app/Badge.jsx', '<aside'),
  '[data-action=jsx-probe]': location('app/ClientJsx.js', '<button'),
};

// Read maps from the actual scripts the browser loaded (webpack dev uses eval/inline maps).
async function checkMaps(scripts, label, file, marker) {
  let verified = false;
  const target = location(file, `'${marker}'`);
  const basename = file.slice(file.lastIndexOf('/'));
  for (const [url, script] of scripts) {
    // webpack development wraps modules in eval strings; maps refer to their decoded bodies.
    const evalBodies = [...script.matchAll(/eval\((?:__webpack_require__\.ts\()?("(?:[^"\\]|\\.)*")\)\)?/g)].map((match) => JSON.parse(match[1]));
    for (const code of evalBodies.length ? evalBodies : [script]) {
      if (!code.includes(marker)) continue;
      for (const match of [...code.matchAll(/sourceMappingURL=([^\s"'\\]+)/g)].slice(-1)) {
        let raw;
        try {
          raw = match[1].startsWith('data:')
            ? JSON.parse(Buffer.from(match[1].split(',')[1], 'base64').toString())
            : await (await fetch(new URL(match[1], url))).json();
        } catch { continue; }
        const map = AnyMap(raw);
        const source = map.sources.findIndex((source) => source?.split('?')[0].split('/').at(-1) === basename.slice(1));
        if (source < 0) continue;
        const original = map.sourcesContent?.[source];
        assert(original === readFileSync(join(fixture, file), 'utf8'), `${label}: browser map contains original ${file}`);
        for (const probe of code.matchAll(new RegExp(`["']${marker}["']`, 'g'))) {
          const prefix = code.slice(0, probe.index).split('\n');
          const position = originalPositionFor(map, { line: prefix.length, column: prefix.at(-1).length });
          const matches = position.source?.split('?')[0].split('/').at(-1) === basename.slice(1)
            && position.line === target.line && position.column === target.column - 1;
          assert(matches, `${label}: generated throw maps to original ${target.line}:${target.column} (${JSON.stringify(position)})`);
          verified ||= matches && original === readFileSync(join(fixture, file), 'utf8');
        }
      }
    }
  }
  if (!verified) writeFileSync(join(OUT, `${label}-scripts.json`), JSON.stringify([...scripts]));
  assert(verified, `${label}: source map chain verified`);
}

async function verify(url, label) {
  const errors = [];
  const listener = (message) => { if (message.type() === 'error') errors.push(message.text()); };
  page.on('console', listener);
  const scripts = new Map();
  const pending = [];
  const responseListener = (response) => {
    if (response.request().resourceType() === 'script') pending.push(response.text().then((code) => scripts.set(response.url(), code)).catch(() => {}));
  };
  page.on('response', responseListener);
  // Capture server DOM before any scripts run; then check that hydration reuses it.
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') {
      await page.waitForSelector('[data-action=increment]', { state: 'attached' });
      await page.evaluate(() => { window.ssrButton ??= document.querySelector('[data-action=increment]'); });
    }
    await route.continue();
  });
  await page.goto(url);
  await page.waitForFunction(() => window.fixture?.hydrated);
  for (const [selector, source] of Object.entries(expected)) {
    const value = `${source.file}:${source.line}:${source.column}`;
    assert(await page.locator(selector).getAttribute('data-source') === value, `${label}: ${selector} = ${value}`);
  }
  for (const selector of ['[data-testid=vendor]', '[data-testid=excluded]']) {
    assert(await page.locator(selector).getAttribute('data-source') === null, `${label}: ${selector} stays unstamped`);
  }
  assert(await page.locator('[data-testid=loader-marker]').textContent() === '__EXISTING_LOADER_WORKED___', `${label}: existing loader still runs`);
  assert(await page.evaluate(() => window.ssrButton === document.querySelector('[data-action=increment]')), `${label}: hydration reuses server DOM`);
  await page.click('[data-action=increment]');
  assert(await page.locator('[data-action=increment]').textContent() === '1', `${label}: client remains interactive`);
  await page.click('[data-action=probe]');
  await page.click('[data-action=jsx-probe]');
  assert(await page.evaluate(() => window.probeStack?.includes('lightback-map-probe') && window.jsxProbeStack?.includes('lightback-jsx-map-probe')), `${label}: probes ran after hydration`);
  await page.click(W + '[data-ref=pillPick]');
  await page.click('[data-action=increment]');
  await page.fill(W + '[data-ref=popText]', 'Next source fixture');
  await page.click(W + '[data-action=pop-send]');
  await page.waitForFunction(() => window.report);
  const report = await page.evaluate(() => window.report);
  assert(JSON.stringify(report.payload.selections[0].source) === JSON.stringify(expected['[data-action=increment]']), `${label}: stamp reaches sent feedback`);
  assert(report.prompt.includes('app/Counter.tsx:' + expected['[data-action=increment]'].line), `${label}: stamp reaches prompt`);
  await Promise.all(pending);
  await checkMaps(scripts, label, 'app/Counter.tsx', 'lightback-map-probe');
  await checkMaps(scripts, label, 'app/ClientJsx.js', 'lightback-jsx-map-probe');
  assert(errors.filter((error) => /hydrat|didn't match|does not match|Minified React error/i.test(error)).length === 0, `${label}: no hydration warnings`);
  await page.screenshot({ path: join(OUT, `${label}.png`) });
  page.off('console', listener);
  page.off('response', responseListener);
  await page.unrouteAll();
  await page.goto('about:blank');
}

try {
  cpSync(fixture, scratch, { recursive: true });
  for (const name of ['source', 'core', 'widget']) {
    await command('pnpm', ['pack', '--pack-destination', scratch], join(root, 'packages', name)).done;
  }
  await command('npm', ['pack', '--pack-destination', scratch], join(scratch, 'vendor')).done;
  rmSync(join(scratch, 'vendor'), { recursive: true });
  const tarballs = readdirSync(scratch).filter((name) => name.endsWith('.tgz')).map((name) => join(scratch, name));
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ private: true, name: 'lightback-next-fixture' }));
  await command('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', ...tarballs,
    `next@${process.env.NEXT_VERSION || '16.4.2'}`, 'react@19.2.4', 'react-dom@19.2.4',
    'typescript@^5.9.3', '@types/react@^19', '@types/node@^22']).done;
  for (const bundler of ['turbopack', 'webpack']) {
    console.log(`Next fixture: ${bundler} development`);
    await verify(await start(['dev', `--${bundler}`]), `${bundler}-dev`);
    await stop();
    console.log(`Next fixture: ${bundler} production build`);
    await command(process.execPath, ['node_modules/next/dist/bin/next', 'build', `--${bundler}`]).done;
    await verify(await start(['start']), `${bundler}-production`);
    await stop();
    rmSync(join(scratch, '.next'), { recursive: true, force: true });
  }
  assert(!/Can't resolve '@lightback\/source'/.test(log), 'packaged loader does not produce resolution warnings');
} catch (error) {
  process.exitCode = 1;
  throw error;
} finally {
  await stop();
  writeFileSync(join(OUT, 'next.log'), log);
  await finish();
  if (!process.exitCode) rmSync(scratch, { recursive: true, force: true });
  else console.error(`Next fixture retained at ${scratch}`);
}
