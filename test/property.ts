import type { Parameters } from 'fast-check';

/** Stable CI corpus; every failure still prints fast-check's seed, path and shrunk actions. */
export function propertyParameters(): Parameters<unknown> {
  return {
    seed: Number(process.env.FC_SEED ?? 230023),
    numRuns: Number(process.env.FC_RUNS ?? 60),
    ...(process.env.FC_PATH ? { path: process.env.FC_PATH } : {}),
    verbose: true,
  };
}
export const maxActions = Number(process.env.FC_ACTIONS ?? 40);
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
/** Drain promise continuations without advancing clocks or releasing controlled jobs. */
export async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
