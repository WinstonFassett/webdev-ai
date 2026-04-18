<script lang="ts">
  import type { RegistryState, ProjectInfo, ServerInfo, BrowserInfo } from '../data/registry.svelte'
  import { projectDisplayName } from '../data/registry.svelte'
  import type { Route } from '../data/router'
  import { navigatePath } from '../data/router'
  import StatusDot from './StatusDot.svelte'
  import ServerTypeBadge from './ServerTypeBadge.svelte'
  import RelativeTime from './RelativeTime.svelte'

  let { registry, route }: { registry: RegistryState; route: Route } = $props()

  // Manual collapse overrides (user can collapse even the auto-expanded project)
  let manualCollapsed: Set<string> = $state(new Set())

  function toggleProject(projectId: string) {
    const next = new Set(manualCollapsed)
    if (next.has(projectId)) next.delete(projectId)
    else next.add(projectId)
    manualCollapsed = next
  }

  function isExpanded(projectId: string): boolean {
    if (manualCollapsed.has(projectId)) return false
    // Auto-expand if current route is within this project
    if (route.projectId === projectId) return true
    return false
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
    onclick={() => navigatePath('#/gateway')}
    class="w-full text-left px-2 py-1 rounded hover:bg-muted transition-colors truncate
      {isActive('gateway') ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}"
  >
    Dashboard
  </button>

  {#if registry.projects.length === 0 && registry.hydrated}
    <p class="text-[10px] text-muted-foreground/50 px-2 pt-2">No projects connected</p>
  {/if}

  {#each registry.projects as project}
    {@const expanded = isExpanded(project.projectId)}
    {@const status = projectStatus(project)}

    <div class="space-y-0.5">
      <!-- Project row -->
      <button
        onclick={() => { toggleProject(project.projectId); navigatePath(`#/project/${project.projectId}`) }}
        class="w-full text-left px-2 py-1 rounded hover:bg-muted transition-colors flex items-center gap-1.5
          {isActive('project', project.projectId) || route.projectId === project.projectId ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}"
      >
        <span class="text-[9px] w-3 shrink-0 text-center">{expanded ? '▾' : '▸'}</span>
        <StatusDot {status} />
        <span class="truncate flex-1">{projectDisplayName(project)}</span>
        {#if project.browsers.length > 0}
          <span class="text-muted-foreground/40 text-[10px] shrink-0">{project.browsers.length}</span>
        {/if}
      </button>

      {#if expanded}
        {#each project.servers as server}
          {@const serverBrowsers = browsersForServer(server)}

          <!-- Server row -->
          <button
            onclick={() => navigatePath(`#/project/${project.projectId}/${server.type}`)}
            class="w-full text-left pl-6 pr-2 py-0.5 rounded hover:bg-muted transition-colors flex items-center gap-1.5 text-[11px]
              {isActive('server', project.projectId, server.type) ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground/70'}"
          >
            <ServerTypeBadge type={server.type} />
            {#if server.endpoints[0]?.port}
              <span class="text-muted-foreground/40 text-[10px]">:{server.endpoints[0].port}</span>
            {/if}
          </button>

          <!-- Browser rows under server -->
          {#each serverBrowsers as browser, i}
            {@const bid = browser.browserId ?? browser.connId}
            <button
              onclick={() => navigatePath(`#/project/${project.projectId}/${server.type}/${bid}`)}
              class="w-full text-left pl-10 pr-2 py-0.5 rounded hover:bg-muted transition-colors flex items-center gap-1.5 text-[11px]
                {isActive('browser', project.projectId, server.type, bid) ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground/50'}"
            >
              <span class="truncate">Browser {i + 1}</span>
              <span class="text-[9px] text-muted-foreground/30 shrink-0"><RelativeTime timestamp={browser.connectedAt} /></span>
            </button>
          {/each}
        {/each}
      {/if}
    </div>
  {/each}
</nav>
