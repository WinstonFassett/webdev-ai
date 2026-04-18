<script lang="ts">
  import type { Route } from '../lib/data/router'
  import { getRegistry } from '../lib/data/registry.svelte'
  import { navigate } from '../lib/data/router'
  import ServerTypeBadge from '../lib/components/ServerTypeBadge.svelte'
  import RelativeTime from '../lib/components/RelativeTime.svelte'
  import ViewTabs from '../lib/components/ViewTabs.svelte'
  import LogStream from '../lib/components/LogStream.svelte'
  import LogSummary from '../lib/components/LogSummary.svelte'
  let { route }: { route: Route } = $props()

  let registry = getRegistry()
  let project = $derived(registry.projects.find(p => p.projectId === route.projectId))
  let server = $derived(project?.servers.find(s => s.type === route.type))
  let browsers = $derived(
    registry.browsers
      .filter(b => b.serverId === server?.id)
      .sort((a, b) => a.connectedAt - b.connectedAt)
  )
</script>

<div class="flex flex-col h-full overflow-hidden">
  <ViewTabs {route} />

  {#if route.tab === 'logs' && server}
    <LogStream filter={{ serverId: server.id }} historyServerIds={[server.id]} />
  {:else}
  <div class="p-6 space-y-6 overflow-y-auto flex-1">
  {#if !server}
    <div class="text-muted-foreground/50 text-sm">Server not found</div>
  {:else}
    <!-- Server header -->
    <div class="space-y-1">
      <div class="flex items-center gap-2">
        <h2 class="text-base font-medium text-foreground font-mono">{server.id}</h2>
        <ServerTypeBadge type={server.type} />
      </div>
      {#if server.name}
        <div class="text-xs text-muted-foreground">{server.name}</div>
      {/if}
      <div class="text-xs text-muted-foreground/50 font-mono">{server.directory ?? ''}</div>
    </div>

    <LogSummary {route} filter={{ serverId: server.id }} historyServerIds={[server.id]} />

    <!-- Endpoints -->
    <div class="border border-border rounded-lg bg-card">
      <div class="px-4 py-2 text-[10px] text-muted-foreground/60 uppercase tracking-wide">
        Endpoints ({server.endpoints.length})
      </div>
      {#each server.endpoints as ep}
        <div class="border-t border-border px-4 py-2.5 flex items-center gap-4 text-xs">
          <span class="font-mono text-foreground">:{ep.port}</span>
          <span class="text-muted-foreground/50">pid {ep.pid}</span>
          <span class="text-muted-foreground/40 text-[10px]"><RelativeTime timestamp={ep.registeredAt} /></span>
        </div>
      {/each}
    </div>

    <!-- Log paths -->
    {#if Object.keys(server.logPaths ?? {}).length > 0}
      <div class="border border-border rounded-lg bg-card">
        <div class="px-4 py-2 text-[10px] text-muted-foreground/60 uppercase tracking-wide">Log Channels</div>
        {#each Object.entries(server.logPaths ?? {}) as [channel, path]}
          <div class="border-t border-border px-4 py-2 flex items-center justify-between text-xs">
            <span class="text-foreground">{channel}</span>
            <span class="text-muted-foreground/40 font-mono text-[10px] truncate max-w-96">{path}</span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Browsers -->
    {#if browsers.length > 0}
      <div class="border border-border rounded-lg bg-card">
        <div class="px-4 py-2 text-[10px] text-muted-foreground/60 uppercase tracking-wide">
          Browsers ({browsers.length})
        </div>
        {#each browsers as browser, i}
          {@const bid = browser.browserId ?? browser.connId}
          <button
            onclick={() => navigate({ ...route, view: 'browser', browserId: bid })}
            class="w-full text-left border-t border-border px-4 py-2.5 hover:bg-muted/30 cursor-pointer transition-colors flex items-center gap-3 text-xs"
          >
            <span class="text-foreground font-medium w-20 shrink-0">Browser {i + 1}</span>
            <div class="flex-1 min-w-0">
              <div class="text-foreground truncate">{browser.title ?? '—'}</div>
              {#if browser.url}
                <div class="text-[10px] text-muted-foreground/50 font-mono truncate">{browser.url}</div>
              {/if}
            </div>
            <span class="text-muted-foreground/40 text-[10px] shrink-0"><RelativeTime timestamp={browser.connectedAt} /></span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
  </div>
  {/if}
</div>
