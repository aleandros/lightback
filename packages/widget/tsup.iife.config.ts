import { defineConfig } from 'tsup';

export default defineConfig([{
  entry: { lightback: 'src/lightback.ts' },
  format: ['iife'],
  globalName: 'Lightback',
  target: 'es2020',
  noExternal: ['@lightback/core'],
  outExtension: () => ({ js: '.iife.js' }),
  sourcemap: true,
  clean: false,
}, {
  entry: { 'lightback-lazy': 'src/lightback-lazy.ts' },
  format: ['iife'],
  globalName: 'Lightback',
  target: 'es2020',
  noExternal: ['@lightback/core'],
  outExtension: () => ({ js: '.iife.js' }),
  sourcemap: true,
  clean: false,
}, {
  entry: { 'lightback-ui': 'src/ui.ts' },
  format: ['esm'],
  target: 'es2020',
  noExternal: ['@lightback/core'],
  sourcemap: true,
  clean: false,
}]);
