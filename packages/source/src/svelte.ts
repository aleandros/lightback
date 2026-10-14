import { parse, type PreprocessorGroup, type AST } from 'svelte/compiler';
import { sourceFilter, type SourceOptions } from './shared';
import { stampTemplate } from './template';

export type SvelteSourceOptions = Omit<SourceOptions, 'parserPlugins'>;

export function transformSvelteSource(code: string, id: string, options: SvelteSourceOptions = {}) {
  const file = sourceFilter(options, /\.svelte$/, ['**/*.svelte'])(id);
  if (!file) return null;
  const ast = parse(code, { filename: file, modern: true });
  const output = stampTemplate(code, file);
  // Walk only template nodes; expression/script ASTs are irrelevant to DOM locations.
  function walk(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value) walk(child); return; }
    const node = value as AST.RegularElement;
    if (node.type === 'RegularElement' && !node.attributes.some((attr) => 'name' in attr && ['data-source', 'data-lb-source'].includes(attr.name))) {
      output.add(node.start, node.attributes[node.attributes.length - 1]?.end ?? node.start + node.name.length + 1);
    }
    for (const [key, child] of Object.entries(value)) {
      if (!['attributes', 'expression', 'test', 'context', 'index', 'key', 'name'].includes(key)) walk(child);
    }
  }
  walk(ast.fragment);
  return output.result();
}
/** Put first in Svelte's preprocess list, on both client and server. */
export default function lightbackSvelteSource(options: SvelteSourceOptions = {}): PreprocessorGroup {
  return { name: 'lightback-source', markup({ content, filename }) {
    return filename ? transformSvelteSource(content, filename, options) ?? undefined : undefined;
  } };
}
