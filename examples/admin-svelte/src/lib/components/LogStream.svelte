<script lang="ts">
  import { getLogEntries, clearEntries, loadHistory, type LogEntry } from '../data/logs.svelte'
  import { navigate, currentRoute } from '../data/router'

  interface LogFilter {
    browserId?: string
    serverId?: string
    serverIds?: string[]
    channels?: string[]
  }

  let { filter = {}, historyServerIds = [] }: { filter?: LogFilter; historyServerIds?: string[] } = $props()

  function setChannels(channels: string[] | undefined) {
    const r = currentRoute()
    navigate({ ...r, channels: channels && channels.length > 0 ? channels : undefined })
  }

  function toggleChannel(ch: string) {
    const current = new Set(filter.channels ?? allChannels)
    if (current.has(ch)) current.delete(ch)
    else current.add(ch)
    const next = [...current]
    if (next.length === allChannels.length && allChannels.every(c => current.has(c))) {
      setChannels(undefined)
    } else {
      setChannels(next)
    }
  }

  let pickerOpen = $state(false)
  let pickerRef: HTMLDivElement | undefined = $state()

  $effect(() => {
    if (!pickerOpen) return
    function onClick(e: MouseEvent) {
      if (pickerRef && !pickerRef.contains(e.target as Node)) pickerOpen = false
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  })

  // Load history from NDJSON files for each server in scope
  let _historyLoaded: string = $state('')
  $effect(() => {
    const key = historyServerIds.join(',')
    if (key && key !== _historyLoaded) {
      _historyLoaded = key
      historyServerIds.forEach(id => loadHistory(id))
    }
  })

  // Log levels in severity order (most severe first)
  const LEVELS = [
    { id: 'error', label: 'Error' },
    { id: 'warn', label: 'Warn' },
    { id: 'info', label: 'Info' },
    { id: 'log', label: 'Log' },
    { id: 'debug', label: 'Debug' },
  ]
  const LEVEL_ORDER: Record<string, number> = { error: 0, warn: 1, info: 2, log: 3, debug: 4 }

  let minLevel: string = $state('debug') // show everything by default
  let autoScroll: boolean = $state(true)
  let scrollContainer: HTMLDivElement | undefined = $state()

  // All entries from the global stream
  let allEntries = getLogEntries()

  // Entries after scope filter but BEFORE channels filter — used to enumerate
  // available channels in the current scope.
  let scopedEntries: LogEntry[] = $derived.by(() => {
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

  let allChannels: string[] = $derived.by(() => {
    const set = new Set<string>()
    for (const e of scopedEntries) set.add(e.channel)
    return [...set].sort()
  })

  let selectedChannels: string[] = $derived(filter.channels ?? allChannels)

  let pickerLabel: string = $derived.by(() => {
    if (!filter.channels || filter.channels.length === 0) return 'All channels'
    if (filter.channels.length === 1) return filter.channels[0]
    return `${filter.channels.length} channels`
  })

  // Client-side filtered view
  let filteredEntries: LogEntry[] = $derived.by(() => {
    let result = allEntries

    // Scope filter (browser/server)
    if (filter.browserId) {
      result = result.filter(e => e.browserId === filter.browserId || e.connId === filter.browserId)
    }
    if (filter.serverId) {
      result = result.filter(e => e.serverId === filter.serverId)
    }
    if (filter.serverIds && filter.serverIds.length > 0) {
      const ids = new Set(filter.serverIds)
      result = result.filter(e => e.serverId !== undefined && ids.has(e.serverId))
    }

    if (filter.channels && filter.channels.length > 0) {
      const set = new Set(filter.channels)
      result = result.filter(e => set.has(e.channel))
    }

    // Level threshold filter
    if (minLevel !== 'debug') {
      const threshold = LEVEL_ORDER[minLevel] ?? 4
      result = result.filter(e => {
        const level = e.payload?.level ?? 'log'
        return (LEVEL_ORDER[level] ?? 3) <= threshold
      })
    }

    return result
  })

  // Auto-scroll on new entries
  $effect(() => {
    const _len = filteredEntries.length
    if (autoScroll && scrollContainer) {
      requestAnimationFrame(() => {
        if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight
      })
    }
  })

  function onScroll() {
    if (!scrollContainer) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    autoScroll = scrollHeight - scrollTop - clientHeight < 50
  }

  function jumpToBottom() {
    autoScroll = true
    if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function levelColor(entry: LogEntry): string {
    const level = entry.payload?.level ?? entry.channel
    if (level === 'error' || entry.channel === 'errors') return 'text-destructive'
    if (level === 'warn') return 'text-warning'
    if (level === 'info') return 'text-info'
    if (level === 'debug') return 'text-muted-foreground/60'
    return 'text-foreground'
  }

  function levelBadge(entry: LogEntry): string {
    const level = entry.payload?.level ?? ''
    if (level === 'error' || entry.channel === 'errors') return 'err'
    if (level === 'warn') return 'wrn'
    if (level === 'info') return 'inf'
    if (level === 'debug') return 'dbg'
    return 'log'
  }

  function entryMessage(entry: LogEntry): string {
    const p = entry.payload
    if (!p) return ''
    if (typeof p === 'string') return p
    if (p.message) return String(p.message)
    if (p.args?.length) return p.args.map(String).join(' ')
    if (p.text) return String(p.text)
    if (p.url) return `${p.method ?? 'GET'} ${p.url} ${p.status ?? ''}`
    return JSON.stringify(p)
  }

  let exportOpen = $state(false)
  let exportRef: HTMLDivElement | undefined = $state()

  // Close export dropdown on outside click
  $effect(() => {
    if (!exportOpen) return
    function onClick(e: MouseEvent) {
      if (exportRef && !exportRef.contains(e.target as Node)) exportOpen = false
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  })

  function entryLevel(entry: LogEntry): string {
    const level = entry.payload?.level ?? ''
    if (level === 'error' || entry.channel === 'errors') return 'error'
    if (level === 'warn') return 'warn'
    if (level === 'info') return 'info'
    if (level === 'debug') return 'debug'
    return 'log'
  }

  function download(filename: string, content: string, mime: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    exportOpen = false
  }

  function exportJsonl() {
    const lines = filteredEntries.map(e => JSON.stringify({
      ts: new Date(e.timestamp).toISOString(),
      level: entryLevel(e),
      channel: e.channel,
      message: entryMessage(e),
      payload: e.payload,
      browserId: e.browserId,
      serverId: e.serverId,
    }))
    download('logs.jsonl', lines.join('\n') + '\n', 'application/x-ndjson')
  }

  function exportText() {
    const lines = filteredEntries.map(e =>
      `${formatTime(e.timestamp)}  ${entryLevel(e).padEnd(5)}  ${e.channel.padEnd(16)}  ${entryMessage(e)}`
    )
    download('logs.log', lines.join('\n') + '\n', 'text/plain')
  }

  function exportCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    const header = 'timestamp,level,channel,message'
    const rows = filteredEntries.map(e =>
      `${new Date(e.timestamp).toISOString()},${entryLevel(e)},${esc(e.channel)},${esc(entryMessage(e))}`
    )
    download('logs.csv', header + '\n' + rows.join('\n') + '\n', 'text/csv')
  }
</script>

<div class="flex flex-col h-full overflow-hidden relative">
  <!-- Toolbar: level dropdown + count + clear -->
  <div class="flex items-center gap-2 px-3 py-1 border-b border-border shrink-0">
    <select
      bind:value={minLevel}
      class="text-[11px] bg-transparent text-muted-foreground border border-border rounded px-1.5 py-0.5 cursor-pointer hover:text-foreground focus:outline-none focus:border-accent"
    >
      {#each LEVELS as lv}
        <option value={lv.id}>{lv.label}+</option>
      {/each}
    </select>

    <!-- Channel picker -->
    <div class="relative" bind:this={pickerRef}>
      <button
        onclick={() => pickerOpen = !pickerOpen}
        class="text-[11px] bg-transparent text-muted-foreground border border-border rounded px-1.5 py-0.5 cursor-pointer hover:text-foreground focus:outline-none focus:border-accent inline-flex items-center gap-1"
        title="Filter channels"
      >
        <span class={filter.channels && filter.channels.length > 0 ? 'text-foreground' : ''}>{pickerLabel}</span>
        <span class="text-muted-foreground/60">▾</span>
      </button>
      {#if pickerOpen}
        <div class="absolute left-0 top-full mt-1 bg-card border border-border rounded shadow-lg z-10 py-1 min-w-48 max-h-80 overflow-y-auto">
          {#if filter.channels && filter.channels.length > 0}
            <div class="flex items-center justify-end px-3 py-1 border-b border-border">
              <button
                onclick={() => setChannels(undefined)}
                class="text-[10px] text-muted-foreground hover:text-foreground"
              >Clear filter</button>
            </div>
          {/if}
          {#if allChannels.length === 0}
            <div class="px-3 py-2 text-[11px] text-muted-foreground/50">No channels yet</div>
          {:else}
            {#each allChannels as ch}
              {@const active = selectedChannels.includes(ch)}
              <button
                onclick={() => toggleChannel(ch)}
                class="w-full flex items-center gap-2 px-3 py-1 text-[11px] hover:bg-muted/50 text-left {active ? 'text-foreground' : 'text-muted-foreground/50'}"
              >
                <span class="w-3 text-[10px]">{active ? '✓' : ''}</span>
                <span class="font-mono">{ch}</span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <div class="flex-1"></div>

    <span class="text-[10px] text-muted-foreground/50">{filteredEntries.length}</span>

    <!-- Export dropdown -->
    <div class="relative" bind:this={exportRef}>
      <button
        onclick={() => exportOpen = !exportOpen}
        disabled={filteredEntries.length === 0}
        class="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
        title="Export logs"
      >Export</button>
      {#if exportOpen}
        <div class="absolute right-0 top-full mt-1 bg-card border border-border rounded shadow-lg z-10 py-1 min-w-24">
          <button onclick={exportJsonl} class="block w-full text-left px-3 py-1 text-[11px] text-foreground hover:bg-muted/50">.jsonl</button>
          <button onclick={exportText} class="block w-full text-left px-3 py-1 text-[11px] text-foreground hover:bg-muted/50">.log</button>
          <button onclick={exportCsv} class="block w-full text-left px-3 py-1 text-[11px] text-foreground hover:bg-muted/50">.csv</button>
        </div>
      {/if}
    </div>

    <button
      onclick={() => clearEntries()}
      class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      title="Clear all logs"
    >
      Clear
    </button>
  </div>

  <!-- Log entries -->
  <div
    bind:this={scrollContainer}
    onscroll={onScroll}
    class="flex-1 overflow-y-auto font-mono text-[11px] leading-[18px]"
  >
    {#if filteredEntries.length === 0}
      <div class="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
        Waiting for logs...
      </div>
    {:else}
      {#each filteredEntries as entry, i (i)}
        <div class="flex gap-2 px-3 py-px hover:bg-muted/30 {entry.channel === 'errors' || entry.payload?.level === 'error' ? 'bg-destructive/5' : ''}">
          <span class="text-muted-foreground/50 shrink-0 w-16">{formatTime(entry.timestamp)}</span>
          <span class="shrink-0 w-7 {levelColor(entry)}">{levelBadge(entry)}</span>
          <span class="shrink-0 w-20 text-muted-foreground/40 truncate">{entry.channel}</span>
          <span class="flex-1 truncate {levelColor(entry)}">{entryMessage(entry)}</span>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Jump to bottom -->
  {#if !autoScroll}
    <button
      onclick={jumpToBottom}
      class="absolute bottom-2 right-4 px-2 py-1 rounded bg-accent text-accent-foreground text-[10px] shadow-lg"
    >
      Jump to bottom
    </button>
  {/if}
</div>
