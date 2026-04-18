// Browser command WebSocket — simple JSON protocol
//
// Gateway → Browser: { id, method, params }
// Browser → Gateway: { id, result } | { id, error }
//
// Browsers connect with ?server=<serverId> where serverId is the stable
// server identity (projectId:type). This survives server restarts.
// Browsers are never evicted — they disconnect naturally when tabs close.

import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws'

// --- Command protocol types ---

interface PendingCommand {
  resolve: (result: any) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface BrowserConnection {
  ws: WsWebSocket
  connId: string
  browserId: string | null
  serverId: string | null     // Stable server identity (projectId:type)
  url: string | null
  title: string | null
  connectedAt: number
  pending: Map<string, PendingCommand>
  nextId: number
}

const browsers = new Map<string, BrowserConnection>()
const connectionOrder: string[] = []

// Hooks for external listeners (admin UI, etc)
type BrowserEventCallback = (event: 'connect' | 'disconnect' | 'init', data: {
  connId: string
  browserId: string | null
  serverId: string | null
  url?: string | null
  title?: string | null
}) => void
const browserEventListeners: Set<BrowserEventCallback> = new Set()
export function onBrowserEvent(cb: BrowserEventCallback) {
  browserEventListeners.add(cb)
  return () => browserEventListeners.delete(cb)
}

// Log event hook — gateway calls this when browser events arrive
type LogEventCallback = (data: { channel: string; payload: any; browserId?: string }) => void
const logEventListeners: Set<LogEventCallback> = new Set()
export function onLogEvent(cb: LogEventCallback) {
  logEventListeners.add(cb)
  return () => logEventListeners.delete(cb)
}
export function emitLogEvent(data: { channel: string; payload: any; browserId?: string }) {
  for (const cb of logEventListeners) cb(data)
}

/** Send a command to a browser and wait for the response */
function sendCommand(conn: BrowserConnection, method: string, params?: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (conn.ws.readyState !== 1 /* OPEN */) {
      reject(new Error('Browser WebSocket not open'))
      return
    }

    const id = String(++conn.nextId)
    const timer = setTimeout(() => {
      conn.pending.delete(id)
      reject(new Error(`Command ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    conn.pending.set(id, { resolve, reject, timer })
    conn.ws.send(JSON.stringify({ id, method, params }))
  })
}

/** Get a browser connection by browserId (exact targeting) */
function getBrowserByBrowserId(browserId: string): BrowserConnection | undefined {
  for (const conn of browsers.values()) {
    if (conn.browserId === browserId) return conn
  }
  return undefined
}

/** Get the latest browser connection, optionally filtered by serverId */
function getLatestBrowser(serverId?: string): BrowserConnection | undefined {
  if (serverId) {
    for (let i = connectionOrder.length - 1; i >= 0; i--) {
      const conn = browsers.get(connectionOrder[i])
      if (conn?.serverId === serverId) return conn
    }
    return undefined
  }
  if (connectionOrder.length === 0) return undefined
  const connId = connectionOrder[connectionOrder.length - 1]
  return browsers.get(connId)
}

/**
 * Send a command to a specific browser.
 * Targeting priority:
 *   1. browserId (exact) — locked session target
 *   2. serverId (latest) — pick latest browser for this server
 *   3. global latest — any connected browser
 */
export function browserCommand(
  opts: { browserId?: string; serverId?: string },
  method: string,
  params?: any,
  timeoutMs?: number,
): Promise<any> {
  let conn: BrowserConnection | undefined

  if (opts.browserId) {
    conn = getBrowserByBrowserId(opts.browserId)
    if (!conn) {
      return Promise.reject(new Error(`Browser ${opts.browserId} not connected`))
    }
  } else {
    conn = getLatestBrowser(opts.serverId)
  }

  if (!conn) {
    const all = getAllBrowsers()
    const details = all.length > 0
      ? ` (${all.length} browser(s) connected: ${all.map(b => b.serverId ?? 'untagged').join(', ')})`
      : ' (no browsers connected)'
    return Promise.reject(new Error(
      opts.serverId
        ? `No browser connected for server ${opts.serverId}${details}`
        : `No browser connected${details}`
    ))
  }
  return sendCommand(conn, method, params, timeoutMs)
}

/** Legacy API: send a command by serverId string (backward compat during migration) */
export function browserCommandLegacy(serverId: string | undefined, method: string, params?: any, timeoutMs?: number): Promise<any> {
  return browserCommand({ serverId }, method, params, timeoutMs)
}

export function getAllBrowsers(): Array<{
  connId: string
  browserId: string | null
  serverId: string | null
  url: string | null
  title: string | null
  connectedAt: number
}> {
  return Array.from(browsers.entries()).map(([connId, conn]) => ({
    connId,
    browserId: conn.browserId,
    serverId: conn.serverId,
    url: conn.url,
    title: conn.title,
    connectedAt: conn.connectedAt,
  }))
}

/** Get browsers affiliated with a specific server */
export function getBrowsersByServer(serverId: string): Array<{
  connId: string
  browserId: string | null
  url: string | null
  title: string | null
  connectedAt: number
}> {
  return getAllBrowsers().filter(b => b.serverId === serverId)
}

export function setupRpcWebSocket(httpServer: { on(event: string, listener: (...args: any[]) => void): void }, rpcPath: string) {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request: any, socket: any, head: any) => {
    const url = request.url ?? ''
    if (url === rpcPath || url.startsWith(rpcPath + '?')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    }
  })

  wss.on('connection', (ws, request: any) => {
    const connId = Math.random().toString(36).slice(2)

    // Parse server ID from query parameter — now carries stable identity (projectId:type)
    let serverId: string | null = null
    const url = request.url ?? ''
    const match = url.match(/[?&]server=([^&]+)/)
    if (match) {
      serverId = decodeURIComponent(match[1])
    }

    const conn: BrowserConnection = {
      ws,
      connId,
      browserId: null,
      serverId,
      url: null,
      title: null,
      connectedAt: Date.now(),
      pending: new Map(),
      nextId: 0,
    }

    browsers.set(connId, conn)
    connectionOrder.push(connId)

    // Handle responses from browser
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())

        // Response to a pending command
        if (msg.id && conn.pending.has(msg.id)) {
          const pending = conn.pending.get(msg.id)!
          conn.pending.delete(msg.id)
          clearTimeout(pending.timer)
          if (msg.error) {
            pending.reject(new Error(msg.error))
          } else {
            pending.resolve(msg.result)
          }
          return
        }

        // Unsolicited message from browser (e.g. browserId announcement)
        if (msg.type === 'init' && msg.browserId) {
          conn.browserId = msg.browserId
          if (msg.url) conn.url = msg.url
          if (msg.title) conn.title = msg.title
          const parts = [`[web-dev-mcp] Browser ${msg.browserId.slice(0, 8)}`]
          if (msg.title) parts.push(`"${msg.title}"`)
          if (msg.url) parts.push(msg.url)
          if (serverId) parts.push(`server=${serverId}`)
          console.log(parts.join('  '))
          for (const cb of browserEventListeners) cb('init', { connId, browserId: conn.browserId, serverId, url: conn.url, title: conn.title })
        }
      } catch {
        // Ignore malformed messages
      }
    })

    const serverInfo = serverId ? ` for server ${serverId}` : ''
    console.log(`[web-dev-mcp] Browser connected (${connId})${serverInfo}`)
    for (const cb of browserEventListeners) cb('connect', { connId, browserId: conn.browserId, serverId })

    ws.on('close', () => {
      // Reject all pending commands
      for (const [, pending] of conn.pending) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Browser disconnected'))
      }
      conn.pending.clear()

      const bid = conn.browserId
      browsers.delete(connId)
      const idx = connectionOrder.indexOf(connId)
      if (idx >= 0) connectionOrder.splice(idx, 1)
      console.log(`[web-dev-mcp] Browser disconnected (${connId})`)
      for (const cb of browserEventListeners) cb('disconnect', { connId, browserId: bid, serverId })
    })
  })

  return wss
}
