<script lang="ts">
  import type { Tab } from '../data/router'
  import { navigatePath, routeToHash, type Route } from '../data/router'

  let { route }: { route: Route } = $props()

  function tabHref(tab: Tab): string {
    return routeToHash({ ...route, tab })
  }

  function isActive(tab: Tab): boolean {
    return route.tab === tab
  }
</script>

<div class="border-b border-border flex items-center gap-1 px-3 shrink-0 h-8">
  <a
    href={tabHref('overview')}
    onclick={(e) => { e.preventDefault(); navigatePath(tabHref('overview')) }}
    class="text-xs px-2 py-1 border-b-2 -mb-px transition-colors
      {isActive('overview') ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
  >Overview</a>
  <a
    href={tabHref('logs')}
    onclick={(e) => { e.preventDefault(); navigatePath(tabHref('logs')) }}
    class="text-xs px-2 py-1 border-b-2 -mb-px transition-colors
      {isActive('logs') ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
  >Logs</a>
</div>
