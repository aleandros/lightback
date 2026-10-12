import type { ConsoleEntry, Level } from '../types';
import { RingBuffer } from '../ring';
import { formatArgs } from '../format';

const LEVELS: Level[] = ['log', 'info', 'warn', 'error', 'debug'];

export function installConsole(buffer: RingBuffer<ConsoleEntry>, maxString: number, isMuted: () => boolean = () => false): () => void {
  if (typeof window === 'undefined' || typeof console === 'undefined') return () => {};
  const originals: Partial<Record<Level, (...args: unknown[]) => void>> = {};
  for (const level of LEVELS) {
    const original = console[level] as (...args: unknown[]) => void;
    if (typeof original !== 'function') continue;
    originals[level] = original;
    console[level] = (...args: unknown[]) => {
      try {
        if (!isMuted()) buffer.push({ t: Date.now(), level, message: formatArgs(args, maxString) });
      } catch {
        /* never break the host */
      }
      original.apply(console, args);
    };
  }
  return () => {
    for (const level of LEVELS) {
      const o = originals[level];
      if (o) console[level] = o;
    }
  };
}
