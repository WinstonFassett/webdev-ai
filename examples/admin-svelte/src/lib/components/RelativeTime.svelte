<script lang="ts">
  let { timestamp }: { timestamp: number } = $props()

  let now = $state(Date.now())

  $effect(() => {
    const id = setInterval(() => { now = Date.now() }, 10_000)
    return () => clearInterval(id)
  })

  function format(ts: number, current: number): string {
    const s = Math.floor((current - ts) / 1000)
    if (s < 60) return 'just now'
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`
    return `${Math.floor(s / 86400)}d ago`
  }

  let text = $derived(format(timestamp, now))
</script>

<span title={new Date(timestamp).toLocaleString()}>{text}</span>
