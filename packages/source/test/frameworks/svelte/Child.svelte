<script>
  import { useLightback, useLightbackWidget } from '@lightback/svelte';
  const client = useLightback();
  const widget = useLightbackWidget();
</script>
<section>
  <button data-action="fixture-open" onclick={() => $widget?.open()}>Feedback</button>
  <button data-testid="target" onclick={() => client.addBreadcrumb('clicked')}>Nested target</button>
  <output data-ref="widget-ready">{$widget ? 'ready' : 'none'}</output>
</section>
