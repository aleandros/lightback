<script>
  import { untrack } from 'svelte';
  import { provideLightback } from '@lightback/svelte';
  import Child from './Child.svelte';
  let { client, context, widget } = $props();
  untrack(() => provideLightback(client, { context, widget }));
  const spread = { 'data-source': 'wrong/spread.svelte:1:1' };
</script>
<main>
  <h1 data-testid="heading" {...spread}>Svelte production feedback</h1>
  <Child />
  <button data-testid="manual" data-source="manual.svelte:2:3">Manual</button>
  <svg><circle data-testid="svg" cx="5" cy="5" r="4" /></svg>
</main>
