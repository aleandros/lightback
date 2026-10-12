import { cp, rm } from 'node:fs/promises';

const demo = new URL('../docs/.vitepress/dist/demo/', import.meta.url);
await rm(demo, { recursive: true, force: true });
await cp(new URL('../examples/playground/dist/', import.meta.url), demo, { recursive: true });
console.log('Static demo included at /lightback/demo/');
