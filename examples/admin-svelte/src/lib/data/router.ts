/** Minimal hash router for admin UI */

export type Tab = 'overview' | 'logs'

export interface Route {
  view: 'gateway' | 'project' | 'server' | 'browser'
  projectId?: string
  type?: string
  browserId?: string
  tab: Tab
  channel?: string
}

const EMPTY_ROUTE: Route = { view: 'gateway', tab: 'overview' }

function popTab(parts: string[]): { parts: string[]; tab: Tab } {
  if (parts[parts.length - 1] === 'logs') {
    return { parts: parts.slice(0, -1), tab: 'logs' }
  }
  return { parts, tab: 'overview' }
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, queryStr = ''] = raw.split('?')
  const params = new URLSearchParams(queryStr)
  const channel = params.get('channel') ?? undefined

  if (!path || path === 'gateway') return { view: 'gateway', tab: 'overview', channel }

  const rawParts = path.split('/')
  // Gateway with tab: #/gateway/logs
  if (rawParts[0] === 'gateway') {
    const { tab } = popTab(rawParts)
    return { view: 'gateway', tab, channel }
  }

  if (rawParts[0] === 'project' && rawParts[1]) {
    const { parts, tab } = popTab(rawParts)
    const projectId = parts[1]
    if (parts[2]) {
      const type = parts[2]
      if (parts[3]) {
        return { view: 'browser', projectId, type, browserId: parts[3], tab, channel }
      }
      return { view: 'server', projectId, type, tab, channel }
    }
    return { view: 'project', projectId, tab, channel }
  }

  return EMPTY_ROUTE
}

function withTab(base: string, tab: Tab): string {
  return tab === 'logs' ? `${base}/logs` : base
}

function withQuery(base: string, route: Route): string {
  if (route.tab === 'logs' && route.channel) {
    return `${base}?channel=${encodeURIComponent(route.channel)}`
  }
  return base
}

export function routeToHash(route: Route): string {
  let base: string
  switch (route.view) {
    case 'gateway': base = withTab('#/gateway', route.tab); break
    case 'project': base = withTab(`#/project/${route.projectId}`, route.tab); break
    case 'server': base = withTab(`#/project/${route.projectId}/${route.type}`, route.tab); break
    case 'browser': base = withTab(`#/project/${route.projectId}/${route.type}/${route.browserId}`, route.tab); break
  }
  return withQuery(base, route)
}

export function navigate(route: Route) {
  const hash = routeToHash(route)
  if (location.hash !== hash) {
    location.hash = hash
  }
}

export function navigatePath(path: string) {
  if (location.hash !== path) {
    location.hash = path
  }
}

/** Get current route from hash */
export function currentRoute(): Route {
  return parseHash(location.hash)
}
