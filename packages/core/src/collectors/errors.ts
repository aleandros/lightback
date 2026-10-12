import type { ErrorEntry } from '../types';
import { RingBuffer } from '../ring';
import { formatValue } from '../format';

export function installErrors(buffer: RingBuffer<ErrorEntry>, maxString: number): () => void {
  if (typeof window === 'undefined') return () => {};
  const onError = (e: ErrorEvent) => {
    const err = e.error as Error | undefined;
    buffer.push({
      t: Date.now(),
      kind: 'error',
      message: (err?.message ?? e.message ?? 'Unknown error').slice(0, maxString),
      stack: err?.stack?.slice(0, maxString),
      source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason as unknown;
    const err = reason instanceof Error ? reason : undefined;
    buffer.push({
      t: Date.now(),
      kind: 'unhandledrejection',
      message: (err?.message ?? formatValue(reason, maxString)).slice(0, maxString),
      stack: err?.stack?.slice(0, maxString),
    });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
