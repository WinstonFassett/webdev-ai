<script lang="ts">
  let { type }: { type: string } = $props()

  const brandColors: Record<string, { bg: string; fg: string }> = {
    vite: { bg: '#646CFF', fg: '#fff' },
    storybook: { bg: '#FF4785', fg: '#fff' },
    nextjs: { bg: 'var(--fg)', fg: 'var(--bg)' },
    astro: { bg: '#FF5D01', fg: '#fff' },
    webpack: { bg: '#8DD6F9', fg: '#1a1a2e' },
  }

  let colors = $derived(brandColors[type] ?? { bg: 'var(--muted)', fg: 'var(--muted-fg)' })
</script>

<span
  class="text-[10px] px-1.5 py-0.5 rounded font-medium capitalize inline-block leading-tight"
  style:background-color={colors.bg}
  style:color={colors.fg}
>{type}</span>
