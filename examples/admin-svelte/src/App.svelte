<script lang="ts">
  import { initTheme, toggleTheme } from './lib/data/theme'
  import { parseHash, type Route } from './lib/data/router'
  import { getRegistry, initRegistry, projectDisplayName, browserOrdinal } from './lib/data/registry.svelte'
  import { connect } from './lib/data/connection'
  import { trackNavigation } from './lib/data/nav-history'
  import SidebarTree from './lib/components/SidebarTree.svelte'
  import ReplPanel from './lib/components/ReplPanel.svelte'
  import CommandPalette from './lib/components/CommandPalette.svelte'
  import GatewayView from './routes/GatewayView.svelte'
  import ProjectView from './routes/ProjectView.svelte'
  import ServerView from './routes/ServerView.svelte'
  import BrowserView from './routes/BrowserView.svelte'

  let theme = $state(initTheme())
  let route: Route = $state(parseHash(location.hash))
  let registry = getRegistry()
  let replOpen = $state(false)

  const paletteCallbacks = {
    onToggleTheme: () => { theme = toggleTheme(theme) },
    onToggleRepl: () => { replOpen = !replOpen },
  }

  $effect(() => {
    const onHashChange = () => {
      route = parseHash(location.hash)
      trackNavigation(location.hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  })

  initRegistry()
  connect()

  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = '#/gateway'
  }

  function onToggleTheme() {
    theme = toggleTheme(theme)
  }

  // Breadcrumb helpers
  let project = $derived(route.projectId ? registry.projects.find(p => p.projectId === route.projectId) : undefined)
  let server = $derived(project && route.type ? project.servers.find(s => s.type === route.type) : undefined)
  let browser = $derived(route.browserId ? registry.browsers.find(b => (b.browserId ?? b.connId) === route.browserId) : undefined)
  let browserLabel = $derived.by(() => {
    if (!browser || !server || !project) return ''
    const siblings = project.browsers.filter(b => b.serverId === server!.id)
    return `Browser ${browserOrdinal(browser, siblings)}`
  })
</script>

<div class="h-screen flex flex-col overflow-hidden">
  <!-- Top bar -->
  <header class="h-8 flex items-center justify-between px-3 border-b border-border shrink-0">
    <nav class="flex items-center gap-1 text-xs min-w-0">
      {#if route.view === 'gateway'}
        <span class="text-foreground font-medium">Dashboard</span>
      {:else}
        <a href="#/gateway" class="text-muted-foreground hover:text-foreground transition-colors">Dashboard</a>
      {/if}

      {#if project}
        <span class="text-muted-foreground/50">/</span>
        {#if route.view === 'project'}
          <span class="text-foreground font-medium truncate">{projectDisplayName(project)}</span>
        {:else}
          <a href="#/project/{project.projectId}" class="text-muted-foreground hover:text-foreground transition-colors truncate">{projectDisplayName(project)}</a>
        {/if}
      {/if}

      {#if server}
        <span class="text-muted-foreground/50">/</span>
        {#if route.view === 'server'}
          <span class="text-foreground font-medium">{server.type}</span>
        {:else}
          <a href="#/project/{project?.projectId}/{server.type}" class="text-muted-foreground hover:text-foreground transition-colors">{server.type}</a>
        {/if}
      {/if}

      {#if browser && route.view === 'browser'}
        <span class="text-muted-foreground/50">/</span>
        <span class="text-foreground font-medium">{browserLabel}</span>
      {/if}
    </nav>
    <div class="flex items-center gap-2">
      <button
        onclick={onToggleTheme}
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        title="Toggle theme"
      >
        {theme === 'dark' ? '☀' : '◑'}
      </button>
    </div>
  </header>

  <!-- Main area: sidebar + content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Sidebar -->
    <aside class="w-48 border-r border-border shrink-0 overflow-y-auto p-2">
      <SidebarTree {registry} {route} />
    </aside>

    <!-- Content -->
    <main class="flex-1 flex flex-col overflow-hidden relative">
      <!-- Loading state -->
      {#if !registry.hydrated}
        <div class="flex-1 flex items-center justify-center">
          <span class="text-sm text-muted-foreground animate-pulse">Connecting...</span>
        </div>
      {:else}
        <!-- Route content -->
        <div class="flex-1 overflow-y-auto">
          {#if route.view === 'gateway'}
            <GatewayView {route} />
          {:else if route.view === 'project'}
            <ProjectView {route} />
          {:else if route.view === 'server'}
            <ServerView {route} />
          {:else if route.view === 'browser'}
            <BrowserView {route} />
          {/if}
        </div>

        <!-- Disconnected overlay -->
        {#if !registry.connected}
          <div class="absolute inset-0 bg-background/60 flex items-center justify-center z-10">
            <span class="text-sm text-muted-foreground animate-pulse">Reconnecting...</span>
          </div>
        {/if}
      {/if}

      <!-- REPL panel -->
      <ReplPanel {route} bind:open={replOpen} />
    </main>
  </div>

  <!-- Status footer -->
  <footer class="h-6 border-t border-border flex items-center px-3 shrink-0 text-[10px] text-muted-foreground gap-3">
    <span class="flex items-center gap-1">
      <span class="w-1.5 h-1.5 rounded-full {registry.connected ? 'bg-success' : 'bg-destructive'}"></span>
      {registry.connected ? 'connected' : 'disconnected'}
    </span>
    <span>{registry.projects.length} project{registry.projects.length !== 1 ? 's' : ''}</span>
    <span>{registry.browsers.length} browser{registry.browsers.length !== 1 ? 's' : ''}</span>
    {#if registry.mcpSessions > 0}
      <span>{registry.mcpSessions} MCP session{registry.mcpSessions !== 1 ? 's' : ''}</span>
    {/if}
  </footer>
</div>

<CommandPalette {registry} callbacks={paletteCallbacks} />
