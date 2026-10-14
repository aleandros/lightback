import { build, preview } from 'vite';
import vue from '@vitejs/plugin-vue';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import vueSource from '../dist/vue.js';
import svelteSource from '../dist/svelte.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('./frameworks', import.meta.url));
const repo = path.resolve(root, '../../../..');

export async function startFrameworkFixture(framework) {
  const out = path.join(repo, 'e2e/out/framework-integrations', framework);
  const common = (ssr) => ({
    configFile: false, root, logLevel: 'warn',
    plugins: framework === 'vue' ? [vueSource(), vue()] : [svelte({ configFile: false, preprocess: [svelteSource({root})] })],
    resolve: { alias: [
      {find: './framework.js', replacement: path.join(root, framework, framework === 'svelte' && ssr ? 'server.js' : 'framework.js')},
      ...['core','vue','svelte'].map(name => ({find: `@lightback/${name}`, replacement: path.join(repo, `packages/${name}/dist/index.js`)})),
      {find: '@lightback/widget/lazy', replacement: path.join(repo, 'packages/widget/dist/lazy.js')},
    ] },
    ssr: { noExternal: true },
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { outDir: path.join(out, ssr ? 'server' : 'client'), emptyOutDir: true, minify: true, sourcemap: true,
      ...(ssr ? {ssr: path.join(root,'server.js'), rollupOptions: {output: {inlineDynamicImports: true}}} : {}) },
  });
  await build(common(true));
  const {render} = await import(pathToFileURL(path.join(out,'server/server.js')).href + `?t=${Date.now()}`);
  const html = await render();
  await build(common(false));
  const index = path.join(out,'client/index.html');
  await writeFile(index, (await readFile(index,'utf8')).replace('<!--ssr-->',html));
  const server = await preview({...common(false), preview: {host:'127.0.0.1',port:0}});
  return { url: server.resolvedUrls.local[0], html, close: () => new Promise((resolve,reject) => server.httpServer.close(e => e ? reject(e) : resolve())) };
}
