/**
 * Registry store — projects, servers, browsers.
 * Hydrates from capnweb getState() on connect, then live-updates via subscribe() stream.
 */

import type { RpcStub } from 'capnweb'
import { onConnection, type AdminAPI } from './connection'
import { pushLogEvent, loadHistory } from './logs.svelte'

export interface BrowserInfo {
  connId: string
  browserId: string | null
  serverId: string | null
  url: string | null
  title: string | null
  connectedAt: number
}

export interface EndpointInfo {
  port: number
  pid: number
  registeredAt: number
}

export interface ServerInfo {
  id: string
  projectId: string
  directory: string
  type: string
  name?: string
  endpoints: EndpointInfo[]
  logPaths: Record<string, string>
  logDir: string
}

export interface ProjectInfo {
  projectId: string
  name: string
  servers: ServerInfo[]
  browsers: BrowserInfo[]
}

export interface RegistryState {
  projects: ProjectInfo[]
  servers: ServerInfo[]
  browsers: BrowserInfo[]
  uptimeMs: number
  mode: string
  mcpSessions: number
  connected: boolean
  hydrated: boolean
}

function groupByProject(servers: ServerInfo[], browsers: BrowserInfo[]): ProjectInfo[] {
  const map = new Map<string, ProjectInfo>()

  for (const s of servers) {
    const pid = s.projectId || s.id
    if (!map.has(pid)) {
      map.set(pid, { projectId: pid, name: pid, servers: [], browsers: [] })
    }
    map.get(pid)!.servers.push(s)
  }

  for (const b of browsers) {
    const server = servers.find(s => s.id === b.serverId)
    if (!server) continue // Every browser has a valid server affiliation
    const pid = server.projectId
    if (!map.has(pid)) {
      map.set(pid, { projectId: pid, name: pid, servers: [], browsers: [] })
    }
    map.get(pid)!.browsers.push(b)
  }

  return Array.from(map.values())
}

// Reactive state
let _state: RegistryState = $state({
  projects: [],
  servers: [],
  browsers: [],
  uptimeMs: 0,
  mode: 'hub',
  mcpSessions: 0,
  connected: false,
  hydrated: false,
})

export function getRegistry(): RegistryState {
  return _state
}

/** Get primary port for a server (first endpoint) */
export function serverPort(server: ServerInfo): number | undefined {
  return server.endpoints[0]?.port
}

/** Display name for a project: name → basename → projectId */
export function projectDisplayName(project: ProjectInfo): string {
  if (project.name && project.name !== project.projectId) return project.name
  const dir = project.servers[0]?.directory
  if (dir) return dir.split('/').pop() ?? project.projectId
  return project.projectId
}

/** Get browser ordinal (1-based) within its server siblings, sorted by connectedAt */
export function browserOrdinal(browser: BrowserInfo, siblings: BrowserInfo[]): number {
  const sorted = [...siblings].sort((a, b) => a.connectedAt - b.connectedAt)
  const bid = browser.browserId ?? browser.connId
  return sorted.findIndex(b => (b.browserId ?? b.connId) === bid) + 1
}

function updateProjects() {
  _state.projects = groupByProject(_state.servers, _state.browsers)
}

function applySnapshot(data: Awaited<ReturnType<AdminAPI['getState']>>) {
  _state.servers = data.servers ?? []
  _state.browsers = data.browsers ?? []
  _state.uptimeMs = data.uptime_ms ?? 0
  _state.mode = data.mode ?? 'hub'
  _state.mcpSessions = data.mcp_sessions ?? 0
  _state.connected = true
  _state.hydrated = true
  updateProjects()
}

function applyEvent(event: { type: string; data: any }) {
  if (event.type === 'browser_connect' && event.data.connId) {
    const existing = _state.browsers.find(b => b.connId === event.data.connId)
    if (!existing) {
      _state.browsers = [..._state.browsers, {
        connId: event.data.connId,
        browserId: event.data.browserId ?? null,
        serverId: event.data.serverId ?? null,
        url: null,
        title: null,
        connectedAt: Date.now(),
      }]
      updateProjects()
    }
  } else if (event.type === 'browser_init' && event.data.connId) {
    const existing = _state.browsers.find(b => b.connId === event.data.connId)
    if (existing) {
      if (event.data.browserId) existing.browserId = event.data.browserId
      if (event.data.serverId) existing.serverId = event.data.serverId
      if (event.data.url) existing.url = event.data.url
      if (event.data.title) existing.title = event.data.title
      _state.browsers = [..._state.browsers]
      updateProjects()
    }
  } else if (event.type === 'browser_disconnect' && event.data.connId) {
    _state.browsers = _state.browsers.filter(b => b.connId !== event.data.connId)
    updateProjects()
  } else if (event.type === 'server_register' && event.data.server) {
    const srv = event.data.server as ServerInfo
    const existing = _state.servers.findIndex(s => s.id === srv.id)
    if (existing >= 0) {
      _state.servers[existing] = srv
      _state.servers = [..._state.servers]
    } else {
      _state.servers = [..._state.servers, srv]
    }
    _state.mode = _state.servers.length > 0 ? 'hybrid' : 'hub'
    updateProjects()
  } else if (event.type === 'server_deregister' && event.data.serverId) {
    _state.servers = _state.servers.filter(s => s.id !== event.data.serverId)
    _state.mode = _state.servers.length > 0 ? 'hybrid' : 'hub'
    updateProjects()
  }
  // Log events → log store (enrich with serverId from browser)
  if (event.type === 'log' && event.data) {
    const browserId = event.data.browserId
    const browser = browserId
      ? _state.browsers.find(b => (b.browserId ?? b.connId) === browserId || b.connId === browserId)
      : undefined
    pushLogEvent({ ...event.data, serverId: browser?.serverId ?? undefined })
  }
}

let streamReader: ReadableStreamDefaultReader | null = null

async function startEventStream(api: RpcStub<AdminAPI>) {
  try {
    const stream = await api.subscribe()
    const reader = stream.getReader()
    streamReader = reader

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      applyEvent(value)
    }
  } catch {
    // Stream ended (disconnect) — cleanup handled by onConnection
  } finally {
    streamReader = null
  }
}

/** Initialize: connect to gateway, hydrate state, start event stream */
export function initRegistry() {
  onConnection(async (api) => {
    if (api) {
      try {
        const state = await api.getState()
        applySnapshot(state)
        startEventStream(api)
      } catch {
        _state.connected = false
      }
    } else {
      // Disconnected — cancel stream reader if active
      streamReader?.cancel().catch(() => {})
      streamReader = null
      _state.connected = false
    }
  })
}
