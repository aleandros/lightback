import { afterEach, expect, it, vi } from 'vitest';
import { uid } from '../src/format';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('uses randomUUID when available', () => {
  vi.stubGlobal('crypto', { randomUUID: () => 'native-id' });
  expect(uid()).toBe('native-id');
});

it('falls back to getRandomValues and sets UUID version and variant', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255));
  vi.stubGlobal('crypto', { getRandomValues });
  expect(uid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  expect(getRandomValues).toHaveBeenCalledOnce();
});

it('works when crypto is missing entirely', () => {
  vi.stubGlobal('crypto', undefined);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  expect(uid()).toBe('00000000-0000-4000-8000-000000000000');
});
