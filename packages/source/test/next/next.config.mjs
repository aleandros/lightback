import { fileURLToPath } from 'node:url';
import { withLightbackSource } from '@lightback/source/next';

const root = fileURLToPath(new URL('.', import.meta.url));
const existingLoader = fileURLToPath(new URL('./after-stamp.cjs', import.meta.url));
const firstLoader = fileURLToPath(new URL('./first-loader.cjs', import.meta.url));
const identityLoader = fileURLToPath(new URL('./identity-loader.cjs', import.meta.url));

export default withLightbackSource(async () => ({
  productionBrowserSourceMaps: true,
  transpilePackages: ['vendor-ui'],
  experimental: { cpus: 2 },
  turbopack: { root, rules: {
    // Deliberately collide with the wrapper's initial combined glob.
    '*.{js,jsx,ts,tsx,mjs,mjsx,mts,mtsx,cjs,cjsx,cts,ctsx}': {
      condition: { not: { path: /(^|\/)node_modules\// } }, loaders: [identityLoader],
    },
    '**/*.tsx': [firstLoader],
    '*.tsx': { loaders: [existingLoader] },
  } },
  webpack(config) {
    config.module.rules.push({ test: /\.tsx$/, exclude: /node_modules/, enforce: 'pre', use: [existingLoader, firstLoader] });
    return config;
  },
}), { include: ['app/**/*.{tsx,jsx,js}'], exclude: ['**/Excluded.tsx'] });
