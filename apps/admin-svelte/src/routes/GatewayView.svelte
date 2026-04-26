<script lang="ts">
  import type { Route } from '../lib/data/router'
  import { getRegistry, projectDisplayName, type ProjectInfo } from '../lib/data/registry.svelte'
  import { navigate } from '../lib/data/router'
  import StatusDot from '../lib/components/StatusDot.svelte'
  import ServerTypeBadge from '../lib/components/ServerTypeBadge.svelte'
  import Duration from '../lib/components/Duration.svelte'
  import ViewTabs from '../lib/components/ViewTabs.svelte'
  import LogStream from '../lib/components/LogStream.svelte'
  import LogSummary from '../lib/components/LogSummary.svelte'

  let { route }: { route: Route } = $props()

  let registry = getRegistry()
  let totalServers = $derived(registry.servers.length)
  let totalBrowsers = $derived(registry.browsers.length)
  let allServerIds = $derived(registry.servers.map(s => s.id))

  function serverTypes(project: ProjectInfo): string[] {
    return [...new Set(project.servers.map(s => s.type))]
  }

  function projectStatus(project: ProjectInfo): 'live' | 'idle' {
    return project.servers.some(s => s.endpoints.length > 0) ? 'live' : 'idle'
  }
</script>

<div class="flex flex-col h-full overflow-hidden">
  <ViewTabs {route} />

  {#if route.tab === 'logs'}
    <LogStream filter={{ channels: route.channels }} historyServerIds={allServerIds} />
  {:else}
  <div class="p-6 space-y-6 overflow-y-auto flex-1">
    <!-- Gateway Status -->
  <div class="border border-border rounded-lg p-4 bg-card">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-sm font-medium text-foreground">Gateway Status</h2>
      <span class="text-xs px-2 py-0.5 rounded-full {registry.connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}">
        {registry.connected ? '● Connected' : '● Disconnected'}
      </span>
    </div>
    <div class="grid grid-cols-4 gap-4">
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground">Uptime</div>
        <div class="text-lg font-medium text-foreground"><Duration since={Date.now() - registry.uptimeMs} /></div>
      </div>
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground">Mode</div>
        <div class="text-lg font-medium text-foreground capitalize">{registry.mode}</div>
      </div>
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground">Servers</div>
        <div class="text-lg font-medium text-foreground">{totalServers}</div>
      </div>
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground">Browsers</div>
        <div class="text-lg font-medium text-foreground">{totalBrowsers}</div>
      </div>
    </div>
  </div>

  <LogSummary {route} filter={{ serverIds: allServerIds }} historyServerIds={allServerIds} />

  <!-- Projects -->
  {#if registry.projects.length > 0}
    <div>
      <h2 class="text-sm font-medium text-foreground mb-3">Projects</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each registry.projects as project}
          <button
            onclick={() => navigate({ ...route, view: 'project', projectId: project.projectId, type: undefined, browserId: undefined })}
            class="border border-border rounded-lg p-4 bg-card hover:bg-muted/30 cursor-pointer transition-colors text-left"
          >
            <div class="flex items-start justify-between mb-3">
              <div>
                <div class="font-medium text-foreground text-sm">{projectDisplayName(project)}</div>
                {#if project.servers[0]?.directory}
                  <div class="text-[11px] text-dim font-mono truncate max-w-48 mt-0.5">
                    {project.servers[0].directory.split('/').slice(-2).join('/')}
                  </div>
                {/if}
              </div>
              <StatusDot status={projectStatus(project)} />
            </div>

            <div class="flex flex-wrap gap-1.5 mb-3">
              {#each serverTypes(project) as type}
                <ServerTypeBadge {type} />
              {/each}
            </div>

            <div class="flex gap-4 text-xs text-muted-foreground">
              <span>{project.servers.length} server{project.servers.length !== 1 ? 's' : ''}</span>
              <span>{project.browsers.length} browser{project.browsers.length !== 1 ? 's' : ''}</span>
            </div>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="text-center py-12 text-dim text-sm">
      No projects connected. Start a dev server with the web-dev-mcp adapter.
    </div>
  {/if}
  </div>
  {/if}
</div>
