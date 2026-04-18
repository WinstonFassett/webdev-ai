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
    const pid = server?.projectId || '__unknown'
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
})

export function getRegistry(): RegistryState {
  return _state
}

/** Get primary port for a server (first endpoint) */
export function serverPort(server: ServerInfo): number | undefined {
  return server.endpoints[0]?.port
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
  }
  // Log events → log store
  if (event.type === 'log' && event.data) {
    pushLogEvent(event.data)
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
