import type { TransformOptions } from '@babel/core';
import path from 'node:path';
import { createTransformer } from './transform';
import type { SourceOptions } from './shared';

type SourceMap = Exclude<TransformOptions['inputSourceMap'], boolean | undefined>;

/** The loader API shared by webpack and Turbopack; no webpack runtime dependency. */
export interface SourceLoaderContext {
  resourcePath: string;
  resourceQuery?: string;
  rootContext: string;
  sourceMap?: boolean;
  getOptions(): SourceOptions;
  cacheable?(flag?: boolean): void;
  callback(error: Error | null, code?: string, map?: SourceMap | string | null): void;
}

const emptyOptions: SourceOptions = {};
const transformers = new WeakMap<SourceOptions, Map<string, ReturnType<typeof createTransformer>>>();

/** Runs before JSX lowering and passes excluded modules (including their maps) through. */
export default function sourceLoader(this: SourceLoaderContext, code: string, inputMap?: SourceMap | string | null): void {
  this.cacheable?.();
  try {
    const options = this.getOptions() ?? emptyOptions;
    const root = options.root ?? this.rootContext;
    let byRoot = transformers.get(options);
    if (!byRoot) transformers.set(options, byRoot = new Map());
    let transform = byRoot.get(root);
    if (!transform) byRoot.set(root, transform = createTransformer({ ...options, root }));
    const result = transform(code, this.resourcePath + (this.resourceQuery ?? ''),
      typeof inputMap === 'string' ? JSON.parse(inputMap) : inputMap ?? undefined);
    // Turbopack's production scope hoisting associates input maps by their file
    // field. Babel omits it; use a module-relative name (never an absolute path).
    if (result?.map) result.map.file = path.basename(this.resourcePath.replace(/\\/g, '/'));
    // Turbopack runs matching rule items as separate loader pipelines and does not
    // pass the previous item's callback map into the next one. Carry the same map
    // inline for map-aware subsequent compilers (including Babel/SWC) to consume.
    // Only embed sources when the host compiler requested source maps.
    const output = result && this.sourceMap && result.map
      ? `${result.code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(result.map)).toString('base64')}`
      : result?.code ?? code;
    this.callback(null, output, result ? result.map : inputMap);
  } catch (error) {
    this.callback(error instanceof Error ? error : new Error(String(error)));
  }
}
