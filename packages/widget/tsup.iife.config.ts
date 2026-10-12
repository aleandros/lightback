import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { lightback: 'src/lightback.ts' },
  format: ['iife'],
  globalName: 'Lightback',
  target: 'es2020',
  noExternal: ['@lightback/core'],
  outExtension: () => ({ js: '.iife.js' }),
  sourcemap: true,
  clean: false,
});
