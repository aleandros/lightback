interface Patch {
  original: Function;
  implementation?: Function;
}
const patches = new WeakMap<Function, Patch>();

/** Deactivate in any order without removing another client's or host's wrapper. */
export function patchMethod<T extends object, K extends keyof T>(target: T, key: K, wrap: (original: T[K]) => T[K]): () => void {
  const original = target[key];
  if (typeof original !== 'function') return () => {};
  const implementation = wrap(original);
  if (typeof implementation !== 'function') throw new TypeError('Lightback: a method patch must be a function');
  const state: Patch = { original, implementation };
  const wrapper = function (this: unknown, ...args: unknown[]) {
    return Reflect.apply(state.implementation ?? state.original, this, args);
  };
  patches.set(wrapper, state);
  target[key] = wrapper as T[K];
  return () => {
    // Release the collector closure even if a later wrapper still calls this function.
    state.implementation = undefined;
    if (target[key] !== wrapper) return;
    let previous = state.original;
    let ancestor = patches.get(previous);
    while (ancestor && !ancestor.implementation) {
      previous = ancestor.original;
      ancestor = patches.get(previous);
    }
    target[key] = previous as T[K];
  };
}
