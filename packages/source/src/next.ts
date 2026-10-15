import { createRequire } from 'node:module';
import type { NextConfig } from 'next';
import type { SourceOptions } from './shared';

export type { SourceOptions } from './shared';
export type NextConfigFactory = (phase: string, context: { defaultConfig: NextConfig }) => NextConfig | Promise<NextConfig>;
type Rules = NonNullable<NonNullable<NextConfig['turbopack']>['rules']>;

function assertJson(value: unknown, location = 'options', ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object' || ancestors.has(value)
    || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Object.getOwnPropertySymbols(value).length) {
    throw new TypeError(`withLightbackSource: ${location} must contain only JSON values (plain objects, arrays and finite primitives).`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertJson(value[i], `${location}[${i}]`, ancestors);
  } else {
    for (const [key, entry] of Object.entries(value)) assertJson(entry, `${location}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

export function withLightbackSource<T extends NextConfig | Promise<NextConfig>>(config: (phase: string, context: { defaultConfig: NextConfig }) => T, options?: SourceOptions): (phase: string, context: { defaultConfig: NextConfig }) => T;
export function withLightbackSource(config?: NextConfig, options?: SourceOptions): NextConfig;
/** Stamp both server and client compilations while retaining Next's SWC pipeline. */
export function withLightbackSource(config: NextConfig | NextConfigFactory = {}, options: SourceOptions = {}): NextConfig | NextConfigFactory {
  assertJson(options);
  // Snapshot once: both compilers must receive identical, JSON-safe options.
  const loaderOptions = JSON.parse(JSON.stringify(options));
  const loader = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
    .resolve('@lightback/source/loader');
  // Arbitrary include globs cannot be translated safely to Turbopack's glob dialect.
  // Dispatch supported extensions, then let the shared project-relative filter decide.
  const extensions = options.include === undefined ? ['tsx', 'jsx']
    : ['js', 'jsx', 'ts', 'tsx', 'mjs', 'mjsx', 'mts', 'mtsx', 'cjs', 'cjsx', 'cts', 'ctsx'];
  const apply = (original: NextConfig): NextConfig => {
    const existing = original.turbopack?.rules ?? {};
    // A separate leading rule preserves the relative order of every host pipeline,
    // including overlapping globs. Moving a colliding key to the front would not.
    const alternatives = [...extensions];
    let glob = `*.{${alternatives.join(',')}}`;
    while (glob in existing) {
      // Repeated brace alternatives leave the match set unchanged. Choose an unused
      // key instead of overwriting or relocating any existing rule.
      alternatives.push(extensions[0]!);
      glob = `*.{${alternatives.join(',')}}`;
    }
    const rules: Rules = {
      [glob]: {
        condition: { not: { path: /(^|\/)node_modules\// } },
        loaders: [{ loader, options: loaderOptions }],
      },
      ...existing,
    };
    return {
      ...original,
      turbopack: { ...original.turbopack, rules },
      webpack(webpackConfig, context) {
        const addRule = (result: typeof webpackConfig) => {
          result.module ??= {};
          result.module.rules ??= [];
          // webpack executes normal loader functions right-to-left, including pre rules.
          // Append AFTER the host hook so we run before its other pre loaders.
          result.module.rules.push({
            test: new RegExp(`\\.(${extensions.join('|')})$`),
            exclude: /(^|[\\/])node_modules([\\/]|$)/,
            enforce: 'pre',
            use: [{ loader, options: loaderOptions }],
          });
          return result;
        };
        const result = original.webpack ? original.webpack.call(this, webpackConfig, context) : webpackConfig;
        return result && typeof result.then === 'function' ? result.then(addRule) : addRule(result);
      },
    };
  };
  if (typeof config !== 'function') return apply(config);
  return function (this: unknown, phase, context) {
    const result = config.call(this, phase, context);
    return result instanceof Promise ? result.then(apply) : apply(result);
  };
}
