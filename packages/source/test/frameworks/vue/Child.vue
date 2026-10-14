<script setup>
import { useLightback, useLightbackWidget } from '@lightback/vue';
const client = useLightback();
const widget = useLightbackWidget();
</script>
<template>
  <section>
    <button data-action="fixture-open" @click="widget?.open()">Feedback</button>
    <button data-testid="target" @click="client.addBreadcrumb('clicked')">Nested target</button>
    <output data-ref="widget-ready">{{ widget ? 'ready' : 'none' }}</output>
  </section>
</template>
