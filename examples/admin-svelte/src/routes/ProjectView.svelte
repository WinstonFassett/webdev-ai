<script lang="ts">
  import type { Route } from '../lib/data/router'
  import { getRegistry, projectDisplayName, type ServerInfo } from '../lib/data/registry.svelte'
  import { navigate } from '../lib/data/router'
  import ServerTypeBadge from '../lib/components/ServerTypeBadge.svelte'
  import StatusDot from '../lib/components/StatusDot.svelte'
  import RelativeTime from '../lib/components/RelativeTime.svelte'
  import ViewTabs from '../lib/components/ViewTabs.svelte'
  import LogStream from '../lib/components/LogStream.svelte'
  import LogSummary from '../lib/components/LogSummary.svelte'
  let { route }: { route: Route } = $props()

  let registry = getRegistry()
  let project = $derived(registry.projects.find(p => p.projectId === route.projectId))
  let serverIds = $derived(project?.servers.map(s => s.id) ?? [])

  function browsersForServer(server: ServerInfo) {
    return (project?.browsers ?? [])
      .filter(b => b.serverId === server.id)
      .sort((a, b) => a.connectedAt - b.connectedAt)
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <ViewTabs {route} />

  {#if route.tab === 'logs'}
    <LogStream filter={{ serverIds }} historyServerIds={serverIds} />
  {:else}
  <div class="p-6 space-y-6 overflow-y-auto flex-1">
  {#if !project}
    <div class="text-muted-foreground/50 text-sm">Project not found: {route.projectId}</div>
  {:else}
    <!-- Project header -->
    <div class="space-y-1">
      <h2 class="text-base font-medium text-foreground">{projectDisplayName(project)}</h2>
      {#if project.servers[0]?.directory}
        <div class="text-xs text-muted-foreground/50 font-mono">{project.servers[0].directory}</div>
      {/if}
      <div class="flex gap-4 text-xs text-muted-foreground mt-1">
        <span>{project.servers.length} server{project.servers.length !== 1 ? 's' : ''}</span>
        <span>{project.browsers.length} browser{project.browsers.length !== 1 ? 's' : ''}</span>
      </div>
    </div>

    <LogSummary {route} filter={{ serverIds }} historyServerIds={serverIds} />

    <!-- Servers -->
    {#each project.servers as server}
      {@const serverBrowsers = browsersForServer(server)}
      <div class="border border-border rounded-lg overflow-hidden bg-card">
        <div class="px-4 py-3">
          <div class="flex items-center gap-2">
            <StatusDot status={server.endpoints.length > 0 ? 'live' : 'idle'} />
            <span class="text-sm font-mono font-medium text-foreground">{server.id}</span>
            <ServerTypeBadge type={server.type} />
            {#if server.name}
              <span class="text-xs text-muted-foreground ml-auto">{server.name}</span>
            {/if}
          </div>

          <!-- Endpoints -->
          {#if server.endpoints.length > 0}
            <div class="mt-2 space-y-1">
              {#each server.endpoints as ep}
                <div class="flex items-center gap-3 text-xs">
                  <span class="font-mono text-foreground">:{ep.port}</span>
                  <span class="text-muted-foreground/50">pid {ep.pid}</span>
                  <span class="text-muted-foreground/40 text-[10px]"><RelativeTime timestamp={ep.registeredAt} /></span>
                </div>
              {/each}
            </div>
          {/if}

          <!-- Log dir -->
          {#if server.logDir}
            <div class="mt-2 text-[10px] text-muted-foreground/40 font-mono truncate">
              {server.logDir}
            </div>
          {/if}
        </div>

        <!-- Browsers for this server -->
        {#if serverBrowsers.length > 0}
          <div class="border-t border-border">
            <div class="px-4 py-1.5 text-[10px] text-muted-foreground/60 uppercase tracking-wide">
              Browsers ({serverBrowsers.length})
            </div>
            {#each serverBrowsers as browser, i}
              {@const bid = browser.browserId ?? browser.connId}
              <button
                onclick={() => navigate({ ...route, view: 'browser', projectId: project.projectId, type: server.type, browserId: bid })}
                class="w-full text-left px-4 py-2 hover:bg-muted/30 cursor-pointer transition-colors flex items-center gap-3 text-xs border-t border-border/50"
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
      </div>
    {/each}
  {/if}
  </div>
  {/if}
</div>
