/**
 * Admin WebSocket RPC — capnweb RpcTarget exposing gateway state + live events.
 *
 * Single WS endpoint at /__admin/ws. Client connects with capnweb + PartySocket.
 * Server exposes AdminAPI with methods for state queries + actions,
 * and a subscribe() method returning a ReadableStream of events.
 */

import { RpcTarget, newWebSocketRpcSession } from 'capnweb'
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws'
import { getAllBrowsers, browserCommand, onBrowserEvent, onLogEvent } from './rpc-server.js'
import { getMcpSessionCount } from './mcp-server.js'
import { getDiagnostics } from './log-reader.js'
import type { ServerRegistry } from './registry.js'
import type { SessionState } from './session.js'

export interface AdminEvent {
  type: string
  data: any
  ts: number
}

export interface AdminDeps {
  registry: ServerRegistry
  session: SessionState
  startedAt: number
}

let deps: AdminDeps

/** Call once at gateway startup to wire dependencies */
export function initAdminRpc(d: AdminDeps) {
  deps = d
}

class AdminAPI extends RpcTarget {
  /** Full gateway state snapshot */
  getState() {
    return {
      uptime_ms: Date.now() - deps.startedAt,
      mode: deps.registry.size() > 0 ? 'hybrid' : 'hub',
      browsers: getAllBrowsers(),
      servers: deps.registry.getAll(),
      mcp_sessions: getMcpSessionCount(),
    }
  }

  /** Query logs/diagnostics for a server */
  getLogs(opts?: {
    serverId?: string
    limit?: number
    level?: string
    search?: string
    browserId?: string
  }) {
    let logPaths: Record<string, string>
    if (opts?.serverId) {
      const server = deps.registry.get(opts.serverId)
      logPaths = server?.logPaths ?? deps.session.files
    } else {
      logPaths = deps.session.files
    }
    return getDiagnostics(logPaths, deps.session, {
      limit: opts?.limit ?? 200,
      level: opts?.level,
      search: opts?.search,
      browserId: opts?.browserId,
    })
  }

  /** Execute JS in a browser */
  async evalInBrowser(code: string, serverId?: string) {
    if (!code) throw new Error('Missing code')
    return browserCommand({ serverId }, 'eval', { code })
  }

  /** Subscribe to live events — returns a ReadableStream pushed by the server */
  subscribe(): ReadableStream<AdminEvent> {
    let cleanup: (() => void) | undefined

    return new ReadableStream<AdminEvent>({
      start(controller) {
        const unsubBrowser = onBrowserEvent((event, data) => {
          const type = event === 'connect' ? 'browser_connect'
            : event === 'init' ? 'browser_init'
            : 'browser_disconnect'
          controller.enqueue({ type, data, ts: Date.now() })
        })

        const unsubLog = onLogEvent((data: any) => {
          controller.enqueue({ type: 'log', data, ts: Date.now() })
        })

        // TODO: server_register / server_deregister events (ticket 15a7)

        cleanup = () => {
          unsubBrowser()
          unsubLog()
        }
      },
      cancel() {
        cleanup?.()
      },
    })
  }
}

/** Set up /__admin/ws WebSocket upgrade handler */
export function setupAdminWebSocket(httpServer: { on(event: string, listener: (...args: any[]) => void): void }) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request: any, socket: any, head: any) => {
    const url = request.url ?? ''
    if (url === '/__admin/ws' || url.startsWith('/__admin/ws?')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
  })

  wss.on('connection', (ws: WsWebSocket) => {
    const api = new AdminAPI()
    // capnweb expects standard WebSocket API — ws package is compatible
    newWebSocketRpcSession(ws as any, api)
    console.log('[admin-rpc] Client connected')
    ws.on('close', () => {
      console.log('[admin-rpc] Client disconnected')
    })
  })

  return wss
}
