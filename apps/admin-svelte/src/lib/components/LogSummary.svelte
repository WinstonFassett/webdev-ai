<script lang="ts">
  import { getLogEntries, loadHistory, type LogEntry } from '../data/logs.svelte'
  import { navigate, type Route } from '../data/router'

  interface LogFilter {
    browserId?: string
    serverId?: string
    serverIds?: string[]
  }

  let {
    route,
    filter = {},
    historyServerIds = [],
    previewCount = 4,
  }: {
    route: Route
    filter?: LogFilter
    historyServerIds?: string[]
    previewCount?: number
  } = $props()

  let _historyLoaded: string = $state('')
  $effect(() => {
    const key = historyServerIds.join(',')
    if (key && key !== _historyLoaded) {
      _historyLoaded = key
      historyServerIds.forEach(id => loadHistory(id))
    }
  })

  let allEntries = getLogEntries()

  let scoped: LogEntry[] = $derived.by(() => {
    // Explicit length read so Svelte tracks array mutation
    const _len = allEntries.length
    void _len
    let r = allEntries
    if (filter.browserId) r = r.filter(e => e.browserId === filter.browserId || e.connId === filter.browserId)
    if (filter.serverId) r = r.filter(e => e.serverId === filter.serverId)
    if (filter.serverIds && filter.serverIds.length > 0) {
      const ids = new Set(filter.serverIds)
      r = r.filter(e => e.serverId !== undefined && ids.has(e.serverId))
    }
    return r
  })

  function isError(e: LogEntry): boolean {
    return e.payload?.level === 'error' || e.channel === 'errors'
  }
  function isWarn(e: LogEntry): boolean {
    return e.payload?.level === 'warn'
  }

  let total = $derived(scoped.length)
  let errorCount = $derived(scoped.filter(isError).length)
  let warnCount = $derived(scoped.filter(isWarn).length)
  let recent = $derived(scoped.slice(-previewCount))

  function formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function entryMessage(e: LogEntry): string {
    const p = e.payload
    if (!p) return ''
    if (typeof p === 'string') return p
    if (p.message) return String(p.message)
    if (p.args?.length) return p.args.map(String).join(' ')
    if (p.text) return String(p.text)
    if (p.url) return `${p.method ?? 'GET'} ${p.url} ${p.status ?? ''}`
    return JSON.stringify(p)
  }

  function goLogs() {
    navigate({ ...route, tab: 'logs' })
  }
</script>

<button
  type="button"
  onclick={goLogs}
  class="w-full block text-left border border-border rounded-lg bg-card hover:bg-muted/30 cursor-pointer transition-colors overflow-hidden"
>
  <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
    <h2 class="text-sm font-medium text-foreground">Recent Logs</h2>
    <div class="flex items-center gap-3 text-xs">
      {#if errorCount > 0}
        <span class="text-destructive">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
      {/if}
      {#if warnCount > 0}
        <span class="text-warning">{warnCount} warn{warnCount !== 1 ? 's' : ''}</span>
      {/if}
      <span class="text-muted-foreground">{total} entries</span>
      <span class="text-dim text-[10px]">View all →</span>
    </div>
  </div>
  {#if recent.length === 0}
    <div class="px-4 py-3 text-xs text-dim">No logs yet</div>
  {:else}
    <div class="font-mono text-[11px]">
      {#each recent as entry}
        <div class="flex gap-2 px-4 py-1 {isError(entry) ? 'text-destructive' : isWarn(entry) ? 'text-warning' : 'text-foreground'}">
          <span class="text-dim shrink-0 w-16">{formatTime(entry.timestamp)}</span>
          <span class="text-dim shrink-0 w-20 truncate">{entry.channel}</span>
          <span class="flex-1 truncate">{entryMessage(entry)}</span>
        </div>
      {/each}
    </div>
  {/if}
</button>
