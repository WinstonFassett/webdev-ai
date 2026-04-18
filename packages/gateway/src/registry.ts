/**
 * Server Registry - tracks dev servers registered with the gateway
 *
 * Identity model:
 *   Project  = directory path (persistent scope)
 *   Server   = projectId:type or projectId:key (stable, survives restarts)
 *   Endpoint = port on a server (can have multiple per server)
 *   Process  = PID serving an endpoint (ephemeral, rotates transparently)
 *   Browser  = affiliated with a server, not an endpoint or process
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

/** Stable project short ID: basename-hash4 (e.g. "nextjs-turbopack-a3f7") */
export function makeProjectId(directory: string): string {
  const name = basename(directory)
  const hash = createHash('sha256').update(directory).digest('hex').slice(0, 4)
  return `${name}-${hash}`
}

/**
 * Stable server identity: projectId:type (default) or projectId:key (user override).
 * This is the join key between browsers and servers — survives restarts.
 */
export function makeServerId(directory: string, type: string, key?: string): string {
  return `${makeProjectId(directory)}:${key || type}`
}

export interface Endpoint {
  port: number
  pid: number
  registeredAt: number
}

export interface RegisteredServer {
  id: string              // Stable identity: projectId:type or projectId:key
  projectId: string       // Stable short ID: basename-hash4
  directory: string       // Absolute project path (persistent scope)
  type: 'vite' | 'nextjs' | 'storybook' | 'astro' | 'generic'
  key?: string            // Optional user-specified key for disambiguation
  name?: string           // Optional friendly name for display
  endpoints: Endpoint[]   // Live processes serving this server (one per port)
  logPaths: Record<string, string>  // Channel → file path (always populated)
  logDir: string          // Absolute path to project's .web-dev-mcp/
}

/** Create per-project log directory and return channel file paths */
export function initProjectLogDir(
  directory: string,
  channels: string[] = ['console', 'errors', 'dev-events', 'server-console'],
): { logDir: string; logPaths: Record<string, string> } {
  const logDir = join(directory, '.web-dev-mcp')
  mkdirSync(logDir, { recursive: true })

  const logPaths: Record<string, string> = {}
  for (const ch of channels) {
    const filePath = join(logDir, `${ch}.ndjson`)
    logPaths[ch] = filePath
    // Truncate on registration (fresh session)
    writeFileSync(filePath, '')
  }

  return { logDir, logPaths }
}

export type ServerEvent = 'register' | 'deregister'
export type ServerEventCallback = (event: ServerEvent, data: { serverId: string; server?: RegisteredServer }) => void

const serverEventListeners: Set<ServerEventCallback> = new Set()

export function onServerEvent(cb: ServerEventCallback): () => void {
  serverEventListeners.add(cb)
  return () => serverEventListeners.delete(cb)
}

function emitServerEvent(event: ServerEvent, data: { serverId: string; server?: RegisteredServer }) {
  for (const cb of serverEventListeners) cb(event, data)
}

export class ServerRegistry {
  private servers = new Map<string, RegisteredServer>()       // server ID → server
  private projectIdIndex = new Map<string, Set<string>>()     // projectId → set of server IDs
  private connectionOrder: string[] = []

  /**
   * Register an endpoint on a server. Creates the server if it doesn't exist.
   * Same server + same port = update PID (restart on same port).
   * Same server + new port = add endpoint (additional instance).
   */
  addEndpoint(serverId: string, serverInfo: Omit<RegisteredServer, 'endpoints'>, endpoint: Endpoint): RegisteredServer {
    let server = this.servers.get(serverId)

    if (server) {
      // Existing server — update or add endpoint
      const existing = server.endpoints.find(e => e.port === endpoint.port)
      if (existing) {
        // Same port, new PID (restart)
        existing.pid = endpoint.pid
        existing.registeredAt = endpoint.registeredAt
        console.log(`[registry] Endpoint updated: ${serverId} port=${endpoint.port} pid=${endpoint.pid}`)
      } else {
        // New port (additional instance)
        server.endpoints.push(endpoint)
        console.log(`[registry] Endpoint added: ${serverId} port=${endpoint.port} pid=${endpoint.pid}`)
      }
      // Update log paths (may change if re-registered with different channels)
      server.logPaths = serverInfo.logPaths
      server.logDir = serverInfo.logDir
      if (serverInfo.name) server.name = serverInfo.name
    } else {
      // New server
      server = { ...serverInfo, endpoints: [endpoint] }
      this.servers.set(serverId, server)

      // Update project index
      let projectServers = this.projectIdIndex.get(server.projectId)
      if (!projectServers) {
        projectServers = new Set()
        this.projectIdIndex.set(server.projectId, projectServers)
      }
      projectServers.add(serverId)

      console.log(`[registry] Server registered: ${serverId} (${server.type}) dir=${server.directory} port=${endpoint.port}`)
    }

    // Track connection order (most recent registration at end)
    const index = this.connectionOrder.indexOf(serverId)
    if (index !== -1) {
      this.connectionOrder.splice(index, 1)
    }
    this.connectionOrder.push(serverId)

    emitServerEvent('register', { serverId, server })
    return server
  }

  /**
   * Remove a specific endpoint from a server.
   * If the server has no more endpoints, the server entry stays (browsers still affiliated).
   */
  removeEndpoint(serverId: string, port: number): void {
    const server = this.servers.get(serverId)
    if (!server) return

    server.endpoints = server.endpoints.filter(e => e.port !== port)
    console.log(`[registry] Endpoint removed: ${serverId} port=${port} (${server.endpoints.length} remaining)`)
    if (server.endpoints.length === 0) {
      emitServerEvent('deregister', { serverId, server })
    }
  }

  /** Remove a server entirely (explicit unregister) */
  remove(id: string): void {
    const server = this.servers.get(id)
    if (server) {
      this.servers.delete(id)
      const projectServers = this.projectIdIndex.get(server.projectId)
      if (projectServers) {
        projectServers.delete(id)
        if (projectServers.size === 0) {
          this.projectIdIndex.delete(server.projectId)
        }
      }
      const index = this.connectionOrder.indexOf(id)
      if (index !== -1) {
        this.connectionOrder.splice(index, 1)
      }
      console.log(`[registry] Server removed: ${id}`)
      emitServerEvent('deregister', { serverId: id, server })
    }
  }

  get(id: string): RegisteredServer | undefined {
    return this.servers.get(id)
  }

  getByProjectId(projectId: string): RegisteredServer[] {
    const serverIds = this.projectIdIndex.get(projectId)
    if (!serverIds) return []
    return [...serverIds].map(id => this.servers.get(id)!).filter(Boolean)
  }

  getByDirectory(directory: string): RegisteredServer[] {
    return this.getAll().filter(s => s.directory === directory)
  }

  getAll(): RegisteredServer[] {
    return Array.from(this.servers.values())
  }

  getByType(type: RegisteredServer['type']): RegisteredServer[] {
    return this.getAll().filter(s => s.type === type)
  }

  /** Find a server that has an endpoint on this port */
  getByPort(port: number): RegisteredServer | undefined {
    return this.getAll().find(s => s.endpoints.some(e => e.port === port))
  }

  getLatest(): RegisteredServer | undefined {
    if (this.connectionOrder.length === 0) return undefined
    const latestId = this.connectionOrder[this.connectionOrder.length - 1]
    return this.servers.get(latestId)
  }

  has(id: string): boolean {
    return this.servers.has(id)
  }

  size(): number {
    return this.servers.size
  }

  /** List all registered project directories */
  directories(): string[] {
    return [...new Set(this.getAll().map(s => s.directory))]
  }

  /** Check if any endpoint on any server has a live process */
  hasLiveEndpoints(serverId: string): boolean {
    const server = this.servers.get(serverId)
    if (!server) return false
    return server.endpoints.length > 0
  }

  /**
   * Remove endpoints whose processes are no longer running.
   * Skips endpoints registered within the last 30s (grace period for process forks).
   * Server entries are never removed — only endpoints are cleaned up.
   */
  cleanupDeadEndpoints(): string[] {
    const cleaned: string[] = []
    const now = Date.now()
    for (const server of this.getAll()) {
      for (const endpoint of [...server.endpoints]) {
        if (now - endpoint.registeredAt < 30_000) continue
        try {
          process.kill(endpoint.pid, 0)
        } catch {
          this.removeEndpoint(server.id, endpoint.port)
          cleaned.push(`${server.id}:${endpoint.port}`)
        }
      }
    }
    return cleaned
  }
}
