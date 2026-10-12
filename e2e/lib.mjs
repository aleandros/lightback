// Shared launcher for the browser suites. Uses the system Chrome (no Playwright browser download).
// Override with CHROME=/path/to/chrome or BASE_URL=http://host:port.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
export const W = 'lightback-widget >> '; // Playwright pierces the widget's shadow root with this prefix

export async function launch(suiteName) {
  const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out', suiteName) + '/';
  fs.mkdirSync(OUT, { recursive: true });
  const launchOpts = { headless: true };
  if (process.env.CHROME) launchOpts.executablePath = process.env.CHROME;
  else launchOpts.channel = 'chrome';
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
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
