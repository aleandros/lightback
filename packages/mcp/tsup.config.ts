import { defineConfig } from 'tsup';
export default defineConfig([
  { entry: ['src/index.ts', 'src/browser.ts'], format: ['esm', 'cjs'], dts: true, sourcemap: true, target: 'node22', clean: true },
  { entry: ['src/cli.ts'], format: ['esm'], sourcemap: true, target: 'node22', splitting: false },
]);
