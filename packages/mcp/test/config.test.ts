import { afterEach, expect, it, vi } from 'vitest';
import { linkSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureConfig, makeConfig, readConfig, writeConfig } from '../src/config';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), linkSync: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it('falls back on filesystems without hard links while preserving exclusive private config creation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lightback-no-links-'));
  const file = join(dir, 'connection.json');
  const c = makeConfig({ project: 'test', origin: 'http://localhost:5173' });
  vi.mocked(linkSync).mockImplementation(() => { throw Object.assign(new Error('Unsupported'), { code: 'ENOTSUP' }); });
  try {
    writeConfig(file, c);
    expect(readConfig(file)).toEqual(c);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(() => writeConfig(file, makeConfig({ project: 'other', origin: c.origin }))).toThrow();
    expect(readConfig(file)).toEqual(c);
    for (const options of [{ project: 'other' }, { origin: 'http://localhost:9999' }, { session: 'other' }, { port: 4320 }]) {
      await expect(ensureConfig(file, options)).rejects.toThrow('differs');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('waits for an exclusive config writer to complete instead of adopting partial JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lightback-partial-config-'));
  const file = join(dir, 'connection.json');
  const c = makeConfig({ project: 'test', origin: 'http://localhost:5173' });
  writeFileSync(file, '{', { mode: 0o600 });
  const finish = setTimeout(() => writeFileSync(file, JSON.stringify(c)), 60);
  try { expect(await ensureConfig(file, {})).toEqual(c); }
  finally { clearTimeout(finish); await rm(dir, { recursive: true, force: true }); }
});

it('removes a partially written fallback config after a disk write failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lightback-config-disk-full-'));
  const file = join(dir, 'connection.json');
  const c = makeConfig({ project: 'test', origin: 'http://localhost:5173' });
  const originalWrite = fs.writeFileSync;
  vi.mocked(linkSync).mockImplementation(() => { throw Object.assign(new Error('Unsupported'), { code: 'ENOTSUP' }); });
  const writer = vi.spyOn(fs, 'writeFileSync').mockImplementation((path, data, options) => {
    if (typeof path === 'number') {
      originalWrite(path, '{');
      throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
    }
    originalWrite(path, data, options);
  });
  try {
    expect(() => writeConfig(file, c)).toThrow('Disk full');
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    writer.mockRestore();
    writeConfig(file, c);
    expect(readConfig(file)).toEqual(c);
  } finally { writer.mockRestore(); await rm(dir, { recursive: true, force: true }); }
});
