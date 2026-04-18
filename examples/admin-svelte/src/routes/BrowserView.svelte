<script lang="ts">
  import type { Route } from '../lib/data/router'
  import { getRegistry, browserOrdinal } from '../lib/data/registry.svelte'
  import { navigatePath } from '../lib/data/router'
  import ServerTypeBadge from '../lib/components/ServerTypeBadge.svelte'
  import RelativeTime from '../lib/components/RelativeTime.svelte'
  import Duration from '../lib/components/Duration.svelte'
  import ViewTabs from '../lib/components/ViewTabs.svelte'
  import LogStream from '../lib/components/LogStream.svelte'
  let { route }: { route: Route } = $props()

  let registry = getRegistry()
  let browser = $derived(registry.browsers.find(b => (b.browserId ?? b.connId) === route.browserId))
  let server = $derived(browser?.serverId ? registry.servers.find(s => s.id === browser.serverId) : undefined)
  let project = $derived(registry.projects.find(p => p.projectId === route.projectId))
  let ordinal = $derived.by(() => {
    if (!browser || !project || !server) return 0
    const siblings = project.browsers.filter(b => b.serverId === server!.id)
    return browserOrdinal(browser, siblings)
  })
</script>

<div class="flex flex-col h-full overflow-hidden">
  <ViewTabs {route} />

  {#if route.tab === 'logs' && browser}
    <LogStream filter={{ browserId: browser.browserId ?? browser.connId }} historyServerIds={server ? [server.id] : []} />
  {:else}
  <div class="p-6 space-y-6 overflow-y-auto flex-1">
  {#if !browser}
    <div class="text-muted-foreground/50 text-sm">Browser not found: {route.browserId}</div>
  {:else}
    <!-- Browser header -->
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <h2 class="text-base font-medium text-foreground">Browser {ordinal}</h2>
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
      </div>
      {#if browser.title}
        <div class="text-sm text-foreground">{browser.title}</div>
      {/if}
      {#if browser.url}
        <div class="text-xs text-muted-foreground font-mono">{browser.url}</div>
      {/if}
    </div>

    <!-- Details -->
    <div class="border border-border rounded-lg bg-card divide-y divide-border">
      <div class="px-4 py-2.5 flex justify-between text-xs">
        <span class="text-muted-foreground">Connection ID</span>
        <span class="font-mono text-foreground">{browser.connId}</span>
      </div>
      <div class="px-4 py-2.5 flex justify-between text-xs">
        <span class="text-muted-foreground">Browser ID</span>
        <span class="font-mono text-foreground">{browser.browserId ?? '—'}</span>
      </div>
      <div class="px-4 py-2.5 flex justify-between text-xs">
        <span class="text-muted-foreground">Connected</span>
        <span class="text-foreground"><RelativeTime timestamp={browser.connectedAt} /></span>
      </div>
      <div class="px-4 py-2.5 flex justify-between text-xs">
        <span class="text-muted-foreground">Duration</span>
        <span class="text-foreground"><Duration since={browser.connectedAt} /></span>
      </div>
      {#if server}
        <div class="px-4 py-2.5 flex justify-between text-xs">
          <span class="text-muted-foreground">Server</span>
          <button
            onclick={() => navigatePath(`#/project/${route.projectId}/${server.type}`)}
            class="font-mono text-accent hover:underline flex items-center gap-1.5"
          >
            {server.id}
            <ServerTypeBadge type={server.type} />
          </button>
        </div>
      {/if}
      {#if server?.endpoints[0]}
        <div class="px-4 py-2.5 flex justify-between text-xs">
          <span class="text-muted-foreground">Port</span>
          <span class="font-mono text-foreground">:{server.endpoints[0].port}</span>
        </div>
      {/if}
      {#if project}
        <div class="px-4 py-2.5 flex justify-between text-xs">
          <span class="text-muted-foreground">Project</span>
          <button
            onclick={() => navigatePath(`#/project/${project.projectId}`)}
            class="font-mono text-accent hover:underline"
          >{project.projectId}</button>
        </div>
      {/if}
    </div>
  {/if}
  </div>
  {/if}
</div>
