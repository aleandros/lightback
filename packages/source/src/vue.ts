import { parse } from '@vue/compiler-sfc';
type RootNode = NonNullable<NonNullable<ReturnType<typeof parse>['descriptor']['template']>['ast']>;
type TemplateChildNode = RootNode['children'][number];
type ElementNode = Extract<TemplateChildNode, { type: 1 }>;
import type { Plugin } from 'vite';
import { sourceFilter, type SourceOptions } from './shared';
import { stampTemplate } from './template';

export interface VueSourceOptions extends Omit<SourceOptions, 'parserPlugins'> {
  /** Match the Vue compiler's custom-element predicate to stamp these native tags too. */
  isCustomElement?: (tag: string) => boolean;
}

export function transformVueSource(code: string, id: string, options: VueSourceOptions = {}) {
  const file = sourceFilter(options, /\.vue$/, ['**/*.vue'])(id);
  if (!file) return null;
  const { descriptor, errors } = parse(code, { filename: file, templateParseOptions: { isCustomElement: options.isCustomElement } });
  if (errors.length) throw errors[0];
  const template = descriptor.template;
  // External and non-HTML templates do not have original HTML tag coordinates.
  if (!template || template.src || (template.lang && template.lang !== 'html') || !template.ast) return null;
  const output = stampTemplate(code, file);
  function walk(node: RootNode | TemplateChildNode) {
    if (node.type !== 0 && node.type !== 1) return;
    if (node.type === 1 && node.tagType === 0 && !explicitSource(node)) {
      output.add(node.loc.start.offset, node.props[node.props.length - 1]?.loc.end.offset ?? node.loc.start.offset + node.tag.length + 1);
    }
    for (const child of node.children) walk(child);
  }
  walk(template.ast);
  return output.result();
}
function explicitSource(node: ElementNode) {
  return node.props.some((prop) => prop.type === 6
    ? ['data-source', 'data-lb-source'].includes(prop.name)
    : prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.isStatic && ['data-source', 'data-lb-source'].includes(prop.arg.content));
}
/** Place before @vitejs/plugin-vue. Runs on original SFCs for client and SSR. */
export default function lightbackVueSource(options: VueSourceOptions = {}): Plugin {
  let resolved = options;
  return {
    name: 'lightback-source-vue', enforce: 'pre',
    configResolved(config) { resolved = { ...options, root: options.root ?? config.root }; },
    transform(code, id) { return transformVueSource(code, id, resolved); },
  };
}
