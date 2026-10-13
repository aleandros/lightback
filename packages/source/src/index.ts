import { createTransformer } from './transform';
import type { SourceOptions } from './shared';

export type { SourceOptions } from './shared';

/** Stamp original JSX/TSX before compilation. Null means the module is outside the filter. */
export function transformSource(code: string, id: string, options: SourceOptions = {}) {
  return createTransformer(options)(code, id);
}
