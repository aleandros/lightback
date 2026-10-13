import type { Plugin } from 'vite';
import type { SourceOptions } from './shared';
import { createTransformer } from './transform';

export type { SourceOptions } from './index';

/** Runs on both client and SSR input, before Vite lowers JSX/TSX. */
export default function lightbackSource(options: SourceOptions = {}): Plugin {
  let transform = createTransformer(options);
  return {
    name: 'lightback-source',
    enforce: 'pre',
    configResolved(config) { transform = createTransformer({ ...options, root: options.root ?? config.root }); },
    transform(code, id) { return transform(code, id); },
  };
}
