import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/lazy.ts'],
  format: ['esm', 'cjs'],
  splitting: true,
  minifySyntax: true,
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['@lightback/core'],
  target: 'es2020',
  esbuildOptions(options, context) {
    options.define = { ...options.define, __LIGHTBACK_CJS__: String(context.format === 'cjs'), __LIGHTBACK_UI_FILE__: JSON.stringify('./lightback-ui.js') };
  },
});
