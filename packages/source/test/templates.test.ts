import { expect, it } from 'vitest';
import { parse as parseVue, compileTemplate } from '@vue/compiler-sfc';
import { parse as parseSvelte, compile, preprocess } from 'svelte/compiler';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { transformVueSource } from '../src/vue';
import svelteSource, { transformSvelteSource } from '../src/svelte';

const options = { root: '/project' };

it.each(['vue','svelte'])('%s filters dependencies, virtual modules, roots and explicit exclusions', (framework) => {
  const transform = framework === 'vue' ? transformVueSource : transformSvelteSource;
  const code = framework === 'vue' ? '<template><div/></template>' : '<div/>';
  for (const id of [`/other/App.${framework}`, `/project/node_modules/App.${framework}`, `/project/.git/App.${framework}`, `/project/App.${framework}?raw`, `\0/project/App.${framework}`, `/project/App.tsx`]) expect(transform(code,id,options)).toBeNull();
  expect(transform(code,`/project/App.${framework}`,{...options,include:[]})).toBeNull();
  expect(transform(code,`/project/App.${framework}`,{...options,exclude:'**/App.*'})).toBeNull();
  expect(transform(code,`C:\\project\\src\\App.${framework}`,{root:'C:\\project'})!.code).toContain(`src/App.${framework}:1:`);
});

it('Vue stamps original native nodes, skips components/control templates and preserves manual bindings', () => {
  const code = `<script setup lang="ts">const fake: string = '<aside/>';</script>\r\n<template>\r\n  <!-- <aside/> -->\r\n  <main><Widget/><template v-if="ok"><svg><path /></svg></template>\r\n    <button v-bind="spread" :title="a > b ? '>' : '<'" />\r\n    <i data-source="manual:1:2"/><b :data-lb-source="source"/><u v-bind:data-source="source"/>\r\n    <my-tag/><component :is="tag"/><slot/><p v-pre>{{literal}}</p>\r\n  </main>\r\n</template>`;
  const result = transformVueSource(code,'/project/src/App.vue',{...options,isCustomElement:t=>t==='my-tag'})!;
  expect(result.code).toContain('<Widget/>');
  expect(result.code).toContain('<template v-if="ok">');
  expect(result.code).toContain('<component :is="tag"/>');
  expect(result.code).toContain('<slot/>');
  expect(result.code).toContain('data-source="src/App.vue:5:5"');
  expect(result.code).toContain('<my-tag data-source=');
  expect(result.code).toContain('<i data-source="manual:1:2"/>');
  expect(result.code).toContain('<b :data-lb-source="source"/>');
  expect(result.code).toContain('<u v-bind:data-source="source"/>');
  expect(result.code).toContain("const fake: string = '<aside/>'");
  expect(transformVueSource(result.code,'/project/src/App.vue',options)!.code).toBe(result.code);
  const descriptor = parseVue(result.code).descriptor;
  for (const ssr of [false,true]) expect(compileTemplate({source:descriptor.template!.content,filename:'App.vue',id:'test',ssr,ssrCssVars:[]}).errors).toEqual([]);
});

it('Vue leaves external and non-HTML templates alone', () => {
  expect(transformVueSource('<template src="./app.html"/>','/project/App.vue',options)).toBeNull();
  expect(transformVueSource('<template lang="pug">div Hello</template>','/project/App.vue',options)).toBeNull();
});

it('Svelte stamps blocks, snippets, SVG and custom elements, without changing component APIs or manual attributes', () => {
  const code = `<script lang="ts">let ok: boolean = true; const spread = {}; const fake = '<aside/>';</script>\n<!-- <aside/> -->\n{#if ok}<main {...spread}><Widget/><my-tag/><svg><path /></svg></main>{:else}<b/>{/if}\n{#each [1,2] as n}<span>{n}</span>{/each}\n{#snippet row()}<i/>{/snippet}\n<button title={ok ? '>' : '<'} {...spread}/><u data-source="manual:1:2"/><b data-lb-source={'legacy:2:3'}/>`;
  const result = transformSvelteSource(code,'/project/src/App.svelte',options)!;
  expect(result.code).toContain('<Widget/>');
  expect(result.code).toContain('<my-tag data-source=');
  expect(result.code).toContain('<i data-source="src/App.svelte:5:17"');
  expect(result.code).toContain("const fake = '<aside/>'");
  expect(result.code).toContain('<u data-source="manual:1:2"/>');
  expect(result.code).toContain("<b data-lb-source={'legacy:2:3'}/>");
  expect(transformSvelteSource(result.code,'/project/src/App.svelte',options)!.code).toBe(result.code);
  for (const generate of ['client','server'] as const) expect(compile(result.code,{filename:'App.svelte',generate}).js.code).toContain('src/App.svelte:');
});

it.each(['vue','svelte'])('%s escapes legal filename characters and maps untouched template tokens to original offsets', (framework) => {
  const transform = framework === 'vue' ? transformVueSource : transformSvelteSource;
  const code = framework === 'vue' ? '<template>\n  <div>π 😀<span>mapped</span></div>\n</template>' : '<div>π 😀<span>mapped</span></div>';
  const filename = `src/a&"{x}\n.${framework}`;
  const result = transform(code,`/project/${filename}`,options)!;
  const offset = result.code.indexOf('mapped');
  const generated = result.code.slice(0,offset).split('\n');
  const original = code.slice(0,code.indexOf('mapped')).split('\n');
  const position = originalPositionFor(new TraceMap(result.map.toString()),{line:generated.length,column:generated.at(-1)!.length});
  expect(position.line).toBe(original.length);
  expect(position.column).toBe(original.at(-1)!.length);
  expect(result.map.sources).toEqual([filename.slice(filename.lastIndexOf('/')+1)]);
  expect(result.map.sourcesContent).toEqual([code]);
  if (framework === 'vue') expect(parseVue(result.code).errors).toEqual([]);
  else expect(() => parseSvelte(result.code,{modern:true})).not.toThrow();
});

it('Svelte preprocessor composes a map and skips missing filenames', async () => {
  const adapter = svelteSource(options);
  const result = await preprocess('<button/>',adapter,{filename:'/project/App.svelte'});
  expect(result.code).toContain('App.svelte:1:1');
  expect(result.map).toBeTruthy();
  expect(await adapter.markup!({content:'<button/>',filename:undefined})).toBeUndefined();
});
