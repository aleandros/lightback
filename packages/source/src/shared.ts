import path from 'node:path';
import picomatch from 'picomatch';
import type { ParserOptions, Visitor } from '@babel/core';
import * as t from '@babel/types';

export interface SourceOptions {
  /** Project root; cwd for transform/Babel, resolved Vite root, or the loader's rootContext. */
  root?: string;
  /** Globs matched against slash-separated project-relative paths. Defaults to the adapter’s source extensions. */
  include?: string | string[];
  /** Additional globs to skip. Dependencies, outside-root and virtual modules always skip. */
  exclude?: string | string[];
  /** Additional Babel parser syntax for transformSource/Vite/Next/loader, e.g. ['decorators-legacy']. */
  parserPlugins?: ParserOptions['plugins'];
}

/** Resolve once per adapter/transform, never emit machine-specific absolute paths. */
export function sourceFilter(options: SourceOptions = {}, extensions = /\.[cm]?[jt]sx?$/, defaults = ['**/*.jsx', '**/*.tsx']): (id: string) => string | null {
  const rootInput = (options.root ?? process.cwd()).replace(/\\/g, '/');
  const paths = /^[A-Za-z]:\//.test(rootInput) ? path.win32 : path.posix;
  const root = paths.resolve(rootInput);
  const include = picomatch(options.include ?? defaults, { dot: true });
  const exclude = picomatch(options.exclude ?? [], { dot: true });
  return (id) => {
    if (/[\0?#]/.test(id)) return null;
    const normalized = id.replace(/\\/g, '/');
    const absolute = paths.resolve(root, normalized);
    const relative = paths.relative(root, absolute).replace(/\\/g, '/');
    if (!relative || relative === '..' || relative.startsWith('../') || paths.isAbsolute(relative)
      || /^[A-Za-z]:/.test(relative) || /(^|\/)(node_modules|\.git)(\/|$)/.test(relative)
      || !extensions.test(relative) || !include(relative) || exclude(relative)) return null;
    return relative;
  };
}

/** Only intrinsic DOM tags: passing source props into user components changes their API. */
export function sourceVisitor(file: string): Visitor {
  return {
    JSXOpeningElement({ node }) {
      if (!t.isJSXIdentifier(node.name) || !/^[a-z]/.test(node.name.name) || !node.loc) return;
      if (node.attributes.some((attr) => t.isJSXAttribute(attr)
        && t.isJSXIdentifier(attr.name)
        && (attr.name.name === 'data-source' || attr.name.name === 'data-lb-source'))) return;
      // Last wins over spreads, so an unrelated spread cannot erase the locator.
      node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-source'),
        // A JS expression preserves quotes, entities and newlines in legal filenames.
        t.jsxExpressionContainer(t.stringLiteral(`${file}:${node.loc.start.line}:${node.loc.start.column + 1}`))));
    },
  };
}
