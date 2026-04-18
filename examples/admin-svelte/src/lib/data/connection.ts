/**
 * Admin WS connection — capnweb RPC over PartySocket (auto-reconnect).
 *
 * PartySocket handles reconnect + backoff. On each new connection,
 * we create a fresh capnweb session and notify listeners with the new API stub.
 */

import { newWebSocketRpcSession, type RpcStub } from 'capnweb'
import ReconnectingWebSocket from 'partysocket/ws'

/** Mirror of server-side AdminAPI (client-side type for the stub) */
export interface AdminAPI {
  getState(): {
    uptime_ms: number
    mode: string
    browsers: Array<{
      connId: string
      browserId: string | null
      serverId: string | null
      url: string | null
      title: string | null
      connectedAt: number
    }>
    servers: Array<{
      id: string
      projectId: string
      directory: string
      type: string
      name?: string
      endpoints: Array<{ port: number; pid: number; registeredAt: number }>
      logPaths: Record<string, string>
      logDir: string
    }>
    mcp_sessions: number
  }

  getLogs(opts?: {
    serverId?: string
    limit?: number
    level?: string
    search?: string
    browserId?: string
  }): any

  evalInBrowser(code: string, serverId?: string): any

  clearLogs(opts?: { serverId?: string; channels?: string[] }): Promise<{
    success: boolean
    truncated: Record<string, Record<string, number>>
  }>

  subscribe(): ReadableStream<{
    type: string
    data: any
    ts: number
  }>
}

function getWsUrl(): string {
  const loc = window.location
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  if (loc.hostname === 'localhost' && loc.port !== '3333') {
    return `ws://localhost:3333/__admin/ws`
  }
  return `${protocol}//${loc.host}/__admin/ws`
}

type ConnectionCallback = (api: RpcStub<AdminAPI> | null) => void

const listeners = new Set<ConnectionCallback>()
let currentApi: RpcStub<AdminAPI> | null = null
let ws: ReconnectingWebSocket | null = null

/** Subscribe to connection changes. Called with stub on connect, null on disconnect. */
export function onConnection(fn: ConnectionCallback): () => void {
  listeners.add(fn)
  // Immediately notify with current state
  if (currentApi) fn(currentApi)
  return () => listeners.delete(fn)
}

function notify(api: RpcStub<AdminAPI> | null) {
  currentApi = api
  for (const fn of listeners) fn(api)
}

/** Start the connection. Safe to call multiple times. */
export function connect() {
  if (ws) return

  ws = new ReconnectingWebSocket(getWsUrl, undefined, {
    maxRetries: Infinity,
    connectionTimeout: 5000,
  })

  ws.addEventListener('open', () => {
    // Fresh capnweb session for each WS connection
    const api = newWebSocketRpcSession<AdminAPI>(ws as unknown as WebSocket)
    notify(api)
  })

  ws.addEventListener('close', () => {
    notify(null)
  })
}

/** Disconnect and stop reconnecting. */
export function disconnect() {
  ws?.close()
  ws = null
  notify(null)
}

/** Get the current API stub (null if not connected). */
export function getApi(): RpcStub<AdminAPI> | null {
  return currentApi
}
