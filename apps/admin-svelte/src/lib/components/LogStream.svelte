<script lang="ts">
  import { getLogEntries, clearAllLogs, loadHistory, type LogEntry } from '../data/logs.svelte'
  import { navigate, currentRoute, routeToHash } from '../data/router'
  import { getRegistry, browserOrdinal } from '../data/registry.svelte'

  interface LogFilter {
    browserId?: string
    serverId?: string
    serverIds?: string[]
    channels?: string[]
  }

  let { filter = {}, historyServerIds = [] }: { filter?: LogFilter; historyServerIds?: string[] } = $props()

  const registry = getRegistry()

  interface SourceInfo {
    projectId?: string
    projectLabel?: string
    projectHref?: string
    serverId?: string
    serverLabel?: string
    serverHref?: string
    browserKey?: string
    browserLabel?: string
    browserHref?: string
  }

  function lookupSource(e: LogEntry): SourceInfo {
    const info: SourceInfo = {}

    if (e.serverId) {
      info.serverId = e.serverId
      const srv = registry.servers.find(s => s.id === e.serverId)
      if (srv) {
        info.projectId = srv.projectId
        const proj = registry.projects.find(p => p.projectId === srv.projectId)
        info.projectLabel = proj && proj.name && proj.name !== proj.projectId
          ? proj.name
          : (srv.directory?.split('/').pop() ?? srv.projectId)
        info.projectHref = routeToHash({ view: 'project', projectId: srv.projectId, tab: 'logs' })
        info.serverLabel = srv.type
        info.serverHref = routeToHash({ view: 'server', projectId: srv.projectId, type: srv.type, tab: 'logs' })
      } else {
        info.serverLabel = e.serverId
      }
    }

    const bid = e.browserId ?? e.connId
    if (bid) {
      const br = registry.browsers.find(b => (b.browserId ?? b.connId) === bid || b.connId === bid)
      if (br && br.serverId) {
        const siblings = registry.browsers.filter(b => b.serverId === br.serverId)
        const key = br.browserId ?? br.connId
        info.browserKey = key
        info.browserLabel = `Browser ${browserOrdinal(br, siblings)}`
        const brSrv = registry.servers.find(s => s.id === br.serverId)
        if (brSrv) {
          info.browserHref = routeToHash({ view: 'browser', projectId: brSrv.projectId, type: brSrv.type, browserId: key, tab: 'logs' })
        }
      } else {
        info.browserKey = bid
        info.browserLabel = `Browser ·${bid.slice(0, 6)}`
      }
    } else if (e.serverId) {
      // No browser on this entry → it's coming from the dev server itself
      info.browserKey = `${e.serverId}:server`
      info.browserLabel = 'Server'
      info.browserHref = info.serverHref
    }

    return info
  }

  function setChannels(channels: string[] | undefined) {
    const r = currentRoute()
    navigate({ ...r, channels: channels && channels.length > 0 ? channels : undefined })
  }

  function toggleChannel(ch: string) {
    const current = new Set(filter.channels ?? allChannels)
    if (current.has(ch)) current.delete(ch)
    else current.add(ch)
    // If the new set equals the full set, clear the filter (means "all")
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

  // Entries after scope filter (browser/server) but BEFORE channels filter —
  // used to enumerate available channels in the current scope.
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

  // Which levels actually vary in the currently-filtered data.
  // A level that is constrained to a single value (either by the view's filter
  // or because the data only contains one value) doesn't need a header.
  let varying = $derived.by(() => {
    const projects = new Set<string>()
    const servers = new Set<string>()
    const browsers = new Set<string>()
    for (const e of filteredEntries) {
      const src = lookupSource(e)
      if (src.projectId) projects.add(src.projectId)
      if (src.serverId) servers.add(src.serverId)
      if (src.browserKey) browsers.add(src.browserKey)
    }
    return {
      project: projects.size > 1,
      server: servers.size > 1,
      browser: browsers.size > 1,
    }
  })

  interface HdrPart { label: string; href?: string }

  type Row =
    | { kind: 'hdr'; key: string; project?: HdrPart; server?: HdrPart; browser?: HdrPart }
    | { kind: 'entry'; key: string; entry: LogEntry }

  // One header row per source-transition, showing only the levels that vary.
  // Headers are sticky at top-0 so DOM order replaces them as the scroll passes boundaries.
  let rows: Row[] = $derived.by(() => {
    const v = varying
    const out: Row[] = []
    if (!v.project && !v.server && !v.browser) {
      for (let i = 0; i < filteredEntries.length; i++) {
        out.push({ kind: 'entry', key: `e:${i}`, entry: filteredEntries[i] })
      }
      return out
    }

    let prevProject: string | undefined
    let prevServer: string | undefined
    let prevBrowser: string | undefined
    for (let i = 0; i < filteredEntries.length; i++) {
      const e = filteredEntries[i]
      const src = lookupSource(e)

      const projChanged = v.project && src.projectId !== prevProject
      const srvChanged = v.server && src.serverId !== prevServer
      const brChanged = v.browser && src.browserKey !== prevBrowser

      if (projChanged || srvChanged || brChanged) {
        const projLabel = v.project ? (src.projectLabel ?? src.projectId) : undefined
        const srvLabel = v.server ? (src.serverLabel ?? src.serverId) : undefined
        const brLabel = v.browser ? (src.browserLabel ?? src.browserKey) : undefined
        out.push({
          kind: 'hdr',
          key: `h:${i}`,
          project: projLabel ? { label: projLabel, href: src.projectHref } : undefined,
          server: srvLabel ? { label: srvLabel, href: src.serverHref } : undefined,
          browser: brLabel ? { label: brLabel, href: src.browserHref } : undefined,
        })
      }

      if (v.project) prevProject = src.projectId
      if (v.server) prevServer = src.serverId
      if (v.browser) prevBrowser = src.browserKey

      out.push({ kind: 'entry', key: `e:${i}`, entry: e })
    }
    return out
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
    if (level === 'debug') return 'text-dim'
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

  let expandedKeys: Set<string> = $state(new Set())
  function toggleExpand(key: string) {
    const next = new Set(expandedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedKeys = next
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
        <span class="text-dim">▾</span>
      </button>
      {#if pickerOpen}
        <div class="absolute left-0 top-full mt-1 bg-card border border-border rounded shadow-lg z-30 py-1 min-w-48 max-h-80 overflow-y-auto">
          {#if filter.channels && filter.channels.length > 0}
            <div class="flex items-center justify-end px-3 py-1 border-b border-border">
              <button
                onclick={() => setChannels(undefined)}
                class="text-[10px] text-muted-foreground hover:text-foreground"
              >Clear filter</button>
            </div>
          {/if}
          {#if allChannels.length === 0}
            <div class="px-3 py-2 text-[11px] text-dim">No channels yet</div>
          {:else}
            {#each allChannels as ch}
              {@const active = selectedChannels.includes(ch)}
              <button
                onclick={() => toggleChannel(ch)}
                class="w-full flex items-center gap-2 px-3 py-1 text-[11px] hover:bg-muted/50 text-left {active ? 'text-foreground' : 'text-dim'}"
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

    <span class="text-[10px] text-dim">{filteredEntries.length}</span>

    <!-- Export dropdown -->
    <div class="relative" bind:this={exportRef}>
      <button
        onclick={() => exportOpen = !exportOpen}
        disabled={filteredEntries.length === 0}
        class="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
        title="Export logs"
      >Export</button>
      {#if exportOpen}
        <div class="absolute right-0 top-full mt-1 bg-card border border-border rounded shadow-lg z-30 py-1 min-w-24">
          <button onclick={exportJsonl} class="block w-full text-left px-3 py-1 text-[11px] text-foreground hover:bg-muted/50">.jsonl</button>
          <button onclick={exportText} class="block w-full text-left px-3 py-1 text-[11px] text-foreground hover:bg-muted/50">.log</button>
          <button onclick={exportCsv} class="block w-full text-left px-3 py-1 text-[11px] text-foreground hover:bg-muted/50">.csv</button>
        </div>
      {/if}
    </div>

    <button
      onclick={() => clearAllLogs({
        browserId: filter.browserId,
        serverId: filter.serverId,
        serverIds: filter.serverIds,
        channels: filter.channels,
      })}
      class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      title="Clear logs in view"
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
      <div class="flex items-center justify-center h-full text-dim text-xs">
        Waiting for logs...
      </div>
    {:else}
      {#each rows as row (row.key)}
        {#if row.kind === 'hdr'}
          <div class="sticky top-0 z-20 flex items-center gap-2 px-3 h-[18px] bg-background border-b border-border/40 text-[10px] uppercase tracking-wide">
            {#if row.project}
              {#if row.project.href}
                <a href={row.project.href} class="font-semibold text-foreground hover:underline">{row.project.label}</a>
              {:else}
                <span class="font-semibold text-foreground">{row.project.label}</span>
              {/if}
            {/if}
            {#if row.project && (row.server || row.browser)}
              <span class="text-dim">·</span>
            {/if}
            {#if row.server}
              {#if row.server.href}
                <a href={row.server.href} class="text-muted-foreground hover:text-foreground hover:underline">{row.server.label}</a>
              {:else}
                <span class="text-muted-foreground">{row.server.label}</span>
              {/if}
            {/if}
            {#if row.server && row.browser}
              <span class="text-dim">·</span>
            {/if}
            {#if row.browser}
              {#if row.browser.href}
                <a href={row.browser.href} class="text-muted-foreground hover:text-foreground hover:underline">{row.browser.label}</a>
              {:else}
                <span class="text-muted-foreground">{row.browser.label}</span>
              {/if}
            {/if}
          </div>
        {:else}
          {@const entry = row.entry}
          {@const msg = entryMessage(entry)}
          {@const isExpanded = expandedKeys.has(row.key)}
          <div
            onclick={() => toggleExpand(row.key)}
            class="px-3 hover:bg-muted/30 cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_20px] {entry.channel === 'errors' || entry.payload?.level === 'error' ? 'bg-destructive/5' : ''}"
          >
            <div class="flex gap-2 py-px text-[11px] leading-[18px]">
              <span class="text-dim shrink-0 w-16">{formatTime(entry.timestamp)}</span>
              <span class="shrink-0 w-7 {levelColor(entry)}">{levelBadge(entry)}</span>
              <span class="shrink-0 w-20 text-dim truncate">{entry.channel}</span>
              <span class="flex-1 truncate {levelColor(entry)}">{msg}</span>
            </div>
            {#if isExpanded}
              <div class="ml-[72px] pb-1 pl-2 border-l border-border/50 text-[11px] leading-[18px] whitespace-pre-wrap break-words {levelColor(entry)}">
                {msg}
              </div>
            {/if}
          </div>
        {/if}
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
