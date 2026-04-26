<script lang="ts">
  import type { RegistryState, ProjectInfo, ServerInfo, BrowserInfo } from '../data/registry.svelte'
  import { projectDisplayName } from '../data/registry.svelte'
  import type { Route } from '../data/router'
  import { navigate } from '../data/router'
  import StatusDot from './StatusDot.svelte'
  import ServerTypeBadge from './ServerTypeBadge.svelte'
  import RelativeTime from './RelativeTime.svelte'

  let { registry, route }: { registry: RegistryState; route: Route } = $props()

  // Explicit expansion state — independent of selection.
  // Selection auto-expands (see $effect) but never auto-collapses;
  // user can toggle via chevron without changing selection.
  let expanded: Set<string> = $state(new Set())

  $effect(() => {
    if (route.projectId && !expanded.has(route.projectId)) {
      const next = new Set(expanded)
      next.add(route.projectId)
      expanded = next
    }
  })

  function toggle(projectId: string) {
    const next = new Set(expanded)
    if (next.has(projectId)) next.delete(projectId)
    else next.add(projectId)
    expanded = next
  }

  function goDashboard() {
    navigate({ ...route, view: 'gateway', projectId: undefined, type: undefined, browserId: undefined })
  }
  function goProject(projectId: string) {
    navigate({ ...route, view: 'project', projectId, type: undefined, browserId: undefined })
  }
  function goServer(projectId: string, type: string) {
    navigate({ ...route, view: 'server', projectId, type, browserId: undefined })
  }
  function goBrowser(projectId: string, type: string, browserId: string) {
    navigate({ ...route, view: 'browser', projectId, type, browserId })
  }

  function projectStatus(project: ProjectInfo): 'live' | 'idle' {
    return project.servers.some(s => s.endpoints.length > 0) ? 'live' : 'idle'
  }

  function browsersForServer(server: ServerInfo): BrowserInfo[] {
    return registry.browsers
      .filter(b => b.serverId === server.id)
      .sort((a, b) => a.connectedAt - b.connectedAt)
  }

  function isActive(view: string, projectId?: string, type?: string, browserId?: string): boolean {
    if (route.view !== view) return false
    if (projectId && route.projectId !== projectId) return false
    if (type && route.type !== type) return false
    if (browserId && route.browserId !== browserId) return false
    return true
  }
</script>

<nav class="text-xs space-y-0.5">
  <!-- Dashboard -->
  <button
    onclick={goDashboard}
    class="w-full text-left px-2 py-1 rounded hover:bg-muted cursor-pointer transition-colors truncate
      {isActive('gateway') ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}"
  >
    Dashboard
  </button>

  {#if registry.projects.length === 0 && registry.hydrated}
    <p class="text-[10px] text-dim px-2 pt-2">No projects connected</p>
  {/if}

  {#each registry.projects as project}
    {@const isExpanded = expanded.has(project.projectId)}
    {@const status = projectStatus(project)}
    {@const projectSelected = isActive('project', project.projectId) || (route.projectId === project.projectId && route.view !== 'gateway')}

    <div class="space-y-0.5">
      <!-- Project row: chevron (toggle) + body (select) -->
      <div
        class="flex items-stretch rounded hover:bg-muted transition-colors
          {projectSelected ? 'bg-muted' : ''}"
      >
        <button
          onclick={() => toggle(project.projectId)}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          class="px-1 py-1 cursor-pointer text-[9px] text-dim hover:text-foreground shrink-0 w-5 text-center"
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        <button
          onclick={() => goProject(project.projectId)}
          class="flex-1 min-w-0 text-left pr-2 py-1 cursor-pointer flex items-center gap-1.5
            {isActive('project', project.projectId) ? 'text-foreground font-medium' : projectSelected ? 'text-foreground' : 'text-muted-foreground'}"
        >
          <StatusDot {status} />
          <span class="truncate flex-1">{projectDisplayName(project)}</span>
          {#if project.browsers.length > 0}
            <span class="text-dim text-[10px] shrink-0">{project.browsers.length}</span>
          {/if}
        </button>
      </div>

      {#if isExpanded}
        {#each project.servers as server}
          {@const serverBrowsers = browsersForServer(server)}

          <!-- Server row -->
          <button
            onclick={() => goServer(project.projectId, server.type)}
            class="w-full text-left pl-6 pr-2 py-0.5 rounded hover:bg-muted cursor-pointer transition-colors flex items-center gap-1.5 text-[11px]
              {isActive('server', project.projectId, server.type) ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}"
          >
            <ServerTypeBadge type={server.type} />
            {#if server.endpoints[0]?.port}
              <span class="text-dim text-[10px]">:{server.endpoints[0].port}</span>
            {/if}
          </button>

          <!-- Browser rows under server -->
          {#each serverBrowsers as browser, i}
            {@const bid = browser.browserId ?? browser.connId}
            <button
              onclick={() => goBrowser(project.projectId, server.type, bid)}
              class="w-full text-left pl-10 pr-2 py-0.5 rounded hover:bg-muted cursor-pointer transition-colors flex items-center gap-1.5 text-[11px]
                {isActive('browser', project.projectId, server.type, bid) ? 'bg-muted text-foreground font-medium' : 'text-dim'}"
            >
              <span class="truncate">Browser {i + 1}</span>
              <span class="text-[9px] text-dim shrink-0"><RelativeTime timestamp={browser.connectedAt} /></span>
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  {/each}
</nav>
