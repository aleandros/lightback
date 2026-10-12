// Runs every suite in sequence against the running dev server. Usage: pnpm e2e [suite...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const all = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && !['run.mjs', 'lib.mjs', 'screenshots.mjs'].includes(f)).sort();
const picked = process.argv.slice(2);
const suites = picked.length ? picked.map((s) => (s.endsWith('.mjs') ? s : `${s}.mjs`)) : all;

try {
  await fetch((process.env.BASE_URL || 'http://localhost:5173') + '/api/feedback');
} catch {
  console.error('Dev server not reachable. Start it with `pnpm dev` first (or set BASE_URL).');
  process.exit(2);
}

let failed = 0;
for (const s of suites) {
  console.log(`\n=== ${s}`);
  const r = spawnSync(process.execPath, [path.join(dir, s)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nAll suites passed');
process.exit(failed ? 1 : 0);
