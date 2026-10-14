<script setup>
import { provideLightback } from '@lightback/vue';
import Child from './Child.vue';
const props = defineProps(['client', 'context', 'widget']);
provideLightback(props.client, { context: () => props.context, widget: props.widget });
const spread = { 'data-source': 'wrong/spread.vue:1:1' };
</script>
<template>
  <main>
    <h1 data-testid="heading" v-bind="spread">Vue production feedback</h1>
    <Child />
    <button data-testid="manual" data-source="manual.vue:2:3">Manual</button>
    <svg><circle data-testid="svg" cx="5" cy="5" r="4" /></svg>
  </main>
</template>
