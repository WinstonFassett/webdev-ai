/** Minimal hash router for admin UI */

export interface Route {
  view: 'gateway' | 'project' | 'server' | 'browser'
  projectId?: string
  type?: string
  browserId?: string
}

const EMPTY_ROUTE: Route = { view: 'gateway' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '')
  if (!path || path === 'gateway') return { view: 'gateway' }

  const parts = path.split('/')
  if (parts[0] === 'project' && parts[1]) {
    const projectId = parts[1]
    if (parts[2]) {
      const type = parts[2]
      if (parts[3]) {
        return { view: 'browser', projectId, type, browserId: parts[3] }
      }
      return { view: 'server', projectId, type }
    }
    return { view: 'project', projectId }
  }

  return EMPTY_ROUTE
}

export function routeToHash(route: Route): string {
  switch (route.view) {
    case 'gateway': return '#/gateway'
    case 'project': return `#/project/${route.projectId}`
    case 'server': return `#/project/${route.projectId}/${route.type}`
    case 'browser': return `#/project/${route.projectId}/${route.type}/${route.browserId}`
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
