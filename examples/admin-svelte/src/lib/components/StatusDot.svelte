<script lang="ts">
  let { status }: { status: 'live' | 'idle' } = $props()
</script>

<span
  class="w-2 h-2 rounded-full inline-block shrink-0 {status === 'live' ? 'bg-success' : 'bg-warning'}"
  title={status === 'live' ? 'Running' : 'No live endpoints'}
></span>
