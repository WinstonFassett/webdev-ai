<script lang="ts">
  let { since }: { since: number } = $props()

  let now = $state(Date.now())

  $effect(() => {
    const id = setInterval(() => { now = Date.now() }, 1_000)
    return () => clearInterval(id)
  })

  function format(start: number, current: number): string {
    const s = Math.floor((current - start) / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ${s % 60}s`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }

  let text = $derived(format(since, now))
</script>

<span>{text}</span>
