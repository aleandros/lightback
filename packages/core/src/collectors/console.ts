import type { ConsoleEntry, Level } from '../types';
import { RingBuffer } from '../ring';
import { formatArgs } from '../format';
import { patchMethod } from './patch';

const LEVELS: Level[] = ['log', 'info', 'warn', 'error', 'debug'];

export function installConsole(buffer: RingBuffer<ConsoleEntry>, maxString: number, isMuted: () => boolean = () => false): () => void {
  if (typeof window === 'undefined' || typeof console === 'undefined') return () => {};
  const undo = LEVELS.map((level) => patchMethod(console, level, (original) => (...args: unknown[]) => {
    try {
      if (!isMuted()) buffer.push({ t: Date.now(), level, message: formatArgs(args, maxString) });
    } catch {
      /* never break the host */
    }
    original.apply(console, args);
  }));
  return () => { undo.forEach((remove) => remove()); };
}
