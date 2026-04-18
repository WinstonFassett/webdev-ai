/** Minimal hash router for admin UI */

export type Tab = 'overview' | 'logs'

export interface Route {
  view: 'gateway' | 'project' | 'server' | 'browser'
  projectId?: string
  type?: string
  browserId?: string
  tab: Tab
}

const EMPTY_ROUTE: Route = { view: 'gateway', tab: 'overview' }

function popTab(parts: string[]): { parts: string[]; tab: Tab } {
  if (parts[parts.length - 1] === 'logs') {
    return { parts: parts.slice(0, -1), tab: 'logs' }
  }
  return { parts, tab: 'overview' }
}

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  if (!path || path === 'gateway') return { view: 'gateway', tab: 'overview' }

  const rawParts = path.split('/')
  // Gateway with tab: #/gateway/logs
  if (rawParts[0] === 'gateway') {
    const { tab } = popTab(rawParts)
    return { view: 'gateway', tab }
  }

  if (rawParts[0] === 'project' && rawParts[1]) {
    const { parts, tab } = popTab(rawParts)
    const projectId = parts[1]
    if (parts[2]) {
      const type = parts[2]
      if (parts[3]) {
        return { view: 'browser', projectId, type, browserId: parts[3], tab }
      }
      return { view: 'server', projectId, type, tab }
    }
    return { view: 'project', projectId, tab }
  }

  return EMPTY_ROUTE
}

function withTab(base: string, tab: Tab): string {
  return tab === 'logs' ? `${base}/logs` : base
}

export function routeToHash(route: Route): string {
  switch (route.view) {
    case 'gateway': return withTab('#/gateway', route.tab)
    case 'project': return withTab(`#/project/${route.projectId}`, route.tab)
    case 'server': return withTab(`#/project/${route.projectId}/${route.type}`, route.tab)
    case 'browser': return withTab(`#/project/${route.projectId}/${route.type}/${route.browserId}`, route.tab)
  }
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
