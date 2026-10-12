// Shared launcher: system Chrome by default; BROWSER selects a Playwright-installed engine.
// Override the default with CHROME=/path/to/chrome, or the server with BASE_URL=http://host:port.
import { chromium, firefox, webkit } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
export const W = 'lightback-widget >> '; // Playwright pierces the widget's shadow root with this prefix

export async function launch(suiteName) {
  const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out', suiteName) + '/';
  fs.mkdirSync(OUT, { recursive: true });
  const launchOpts = { headless: true };
  const engine = process.env.BROWSER;
  if (engine && !['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error(`Unknown BROWSER: ${engine}`);
  if (!engine && process.env.CHROME) launchOpts.executablePath = process.env.CHROME;
  else if (!engine) launchOpts.channel = 'chrome';
  const browser = await ({ chromium, firefox, webkit }[engine || 'chromium']).launch(launchOpts);
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[browser console.error]', m.text().slice(0, 160)); });
  const assert = (cond, msg) => { if (!cond) { console.error('ASSERT FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); };
  const received = async () => (await fetch(BASE_URL + '/api/feedback')).json();
  const reset = () => fetch(BASE_URL + '/api/feedback', { method: 'DELETE' });
  const finish = async (ignore = []) => {
    const unexpected = pageErrors.filter((m) => !m.includes("reading 'total'") && !m.includes('token refresh') && !ignore.some((s) => m.includes(s)));
    assert(unexpected.length === 0, `no unexpected page errors (${unexpected.join(' | ')})`);
    await browser.close();
    console.log(process.exitCode ? `E2E FAILED (${suiteName})` : `E2E PASSED (${suiteName})`);
  };
  return { browser, page, OUT, assert, received, reset, finish, pageErrors };
}
