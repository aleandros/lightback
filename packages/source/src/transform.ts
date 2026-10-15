import { transformSync, type TransformOptions } from '@babel/core';
import { sourceFilter, sourceVisitor, type SourceOptions } from './shared';

/** Cache path/glob setup for adapters that process a module graph. */
export function createTransformer(options: SourceOptions = {}) {
  const filter = sourceFilter(options);
  return (code: string, id: string, inputSourceMap?: TransformOptions['inputSourceMap']) => {
    const file = filter(id);
    if (!file) return null;
    const typescript = /\.[cm]?tsx?$/.test(file);
    const result = transformSync(code, {
      filename: file,
      // Maps resolve relative to the transformed module, not the project root.
      sourceFileName: file.slice(file.lastIndexOf('/') + 1),
      babelrc: false,
      configFile: false,
      browserslistConfigFile: false,
      sourceMaps: true,
      inputSourceMap,
      sourceType: 'unambiguous',
      parserOpts: { plugins: [
        ...(!typescript || file.endsWith('x') ? ['jsx' as const] : []),
        ...(typescript ? ['typescript' as const] : []),
        ...(options.parserPlugins ?? []),
      ] },
      generatorOpts: { retainLines: true },
      plugins: [() => ({ visitor: sourceVisitor(file) })],
    });
    return result?.code == null ? null : { code: result.code, map: result.map ?? null };
  };
}
