import type { PluginObj } from '@babel/core';
import { sourceFilter, sourceVisitor, type SourceOptions } from './shared';

export type { SourceOptions } from './shared';

/** Register before JSX lowering; use the host's JSX/TypeScript parser configuration. */
export default function lightbackSourceBabel(_api: unknown, options: SourceOptions = {}): PluginObj {
  const filter = sourceFilter(options);
  return {
    name: 'lightback-source',
    visitor: {
      Program(program, state) {
        const file = state.filename && filter(state.filename);
        if (file) program.traverse(sourceVisitor(file));
      },
    },
  };
}
