/**
 * CDP Relay — bridges between Playwright and the Chrome extension.
 *
 * Based on Playwriter's proven relay pattern (github.com/remorses/playwriter).
 * Supports multiple concurrent Playwright/CDP clients, each with session-scoped
 * event routing.
 *
 * Passive/on-demand debugging:
 *   Extension detects dev pages and announces them as "available" without attaching
 *   the debugger. The relay requests debugging only when an agent needs CDP access
 *   (via ensureDebugging()). After a period of inactivity (idle TTL), the relay
 *   sends 'releaseDebug' to detach the debugger and stop the browser banner.
 *
 * WebSocket endpoints:
 *   /__cdp-extension     — extension connects here
 *   /devtools/browser/*  — Playwright clients connect here via connectOverCDP
 *
 * HTTP endpoints (Playwright discovery):
 *   /json/version   — browser info with rewritten webSocketDebuggerUrl
 *   /json/list      — list of attached targets
 *
 * Protocol (extension ↔ relay):
 *   EXT→RELAY availability: { method: 'tabAvailable', params: { tabId, url, serverId, projectId } }
 *   EXT→RELAY availability: { method: 'tabUnavailable', params: { tabId } }
 *   RELAY→EXT control:      { method: 'requestDebug', params: { tabId? } }
 *   RELAY→EXT control:      { method: 'releaseDebug', params: { tabId? } }
 *   EXT→RELAY events:       { method: 'forwardCDPEvent', params: { sessionId, method, params } }
 *   EXT→RELAY responses:    { id, result } or { id, error }
 *   RELAY→EXT commands:     { id, method: 'forwardCDPCommand', params: { sessionId, method, params } }
 *
 * CDP commands handled locally (not forwarded):
 *   Browser.getVersion, Browser.setDownloadBehavior, Target.setDiscoverTargets,
 *   Target.attachToTarget, Target.getTargetInfo, Target.getTargets
 *
 * CDP commands with special handling:
 *   Target.setAutoAttach — forward, then synthesize Target.attachedToTarget for known targets
 *   Runtime.enable — forward, then wait for executionContextCreated before responding
 */

import { WebSocket, WebSocketServer } from 'ws'
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Browser, Page, BrowserContext } from '@xmorse/playwright-core'

export interface CDPRelayOptions {
  gatewayPort: number
  /** Idle timeout in ms before auto-releasing debugging. Default: 5 minutes. 0 = no auto-release. */
  idleTimeoutMs?: number
}

interface StoredTarget {
  sessionId: string
  targetInfo: any // Full CDP TargetInfo as received from extension — never reconstruct
}

interface AvailableTab {
  tabId: number
  url: string
  serverId: string
  projectId: string
}

/** Per-client state for each connected Playwright/CDP client */
interface PlaywrightClient {
  ws: WebSocket
  clientId: string
  /** Sessions this client has been told about (for dedup + filtered routing) */
  announcedSessions: Set<string>
  /** Whether this client has called Target.setAutoAttach (subscribes to all targets) */
  subscribedToAll: boolean
}

let nextClientId = 1

export class CDPRelay {
  private extensionWs: WebSocket | null = null
  private extensionWss: WebSocketServer
  private playwrightWss: WebSocketServer
  private clients = new Map<string, PlaywrightClient>()
  private targets = new Map<string, StoredTarget>()
  private availableTabs = new Map<number, AvailableTab>()
  private pendingCommands = new Map<number, {
    resolve: (v: any) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private nextCommandId = 1
  private gatewayPort: number
  private events = new EventEmitter() // Internal event bus for Runtime.enable wait pattern
  private pwBrowser: Browser | null = null
  private pwConnecting = false

  // On-demand debugging state
  private debuggingActive = false
  private debuggingRequested = false
  private idleTimeoutMs: number
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: CDPRelayOptions) {
    this.gatewayPort = options.gatewayPort
    this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000 // 5 minutes default
    this.extensionWss = new WebSocketServer({ noServer: true })
    this.playwrightWss = new WebSocketServer({ noServer: true })
    this.extensionWss.on('connection', (ws) => this.onExtensionConnect(ws))
    this.playwrightWss.on('connection', (ws) => this.onPlaywrightConnect(ws))
  }

  /** Debugging is active and has targets */
  get isAvailable(): boolean {
    return this.extensionWs?.readyState === WebSocket.OPEN && this.targets.size > 0
  }

  /** Extension is connected and has available tabs — debugging can be activated */
  get canActivate(): boolean {
    return this.extensionWs?.readyState === WebSocket.OPEN && this.availableTabs.size > 0
  }

  /**
   * Ensure debugging is active. If not, request it from the extension and wait
   * for targets to appear. Returns true if debugging is active after the call.
   * Resets the idle timer on every call.
   */
  async ensureDebugging(): Promise<boolean> {
    this.resetIdleTimer()

    if (this.isAvailable) return true
    if (!this.canActivate) return false

    return this.requestDebugging()
  }

  /**
   * Request the extension to start debugging all available tabs.
   * Waits up to 5s for at least one target to appear.
   */
  async requestDebugging(): Promise<boolean> {
    if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) return false
    if (this.debuggingRequested && this.debuggingActive) return true

    console.log('[cdp-relay] Requesting debugging from extension...')
    this.debuggingRequested = true

    this.extensionWs.send(JSON.stringify({ method: 'requestDebug', params: {} }))

    // Wait for at least one target to appear
    if (this.targets.size > 0) {
      this.debuggingActive = true
      return true
    }

    return new Promise<boolean>((resolve) => {
      const handler = (event: any) => {
        if (event.method === 'Target.attachedToTarget') {
          clearTimeout(timer)
          this.events.off('cdp:event', handler)
          this.debuggingActive = true
          resolve(true)
        }
      }
      const timer = setTimeout(() => {
        this.events.off('cdp:event', handler)
        console.log('[cdp-relay] Timed out waiting for debug targets (5s)')
        resolve(false)
      }, 5000)
      this.events.on('cdp:event', handler)
    })
  }

  /**
   * Release debugging — detach debugger from all tabs.
   * The extension will send Target.detachedFromTarget events.
   */
  releaseDebugging() {
    if (!this.debuggingActive && !this.debuggingRequested) return

    console.log('[cdp-relay] Releasing debugging...')
    this.debuggingActive = false
    this.debuggingRequested = false
    this.targets.clear()
    this.clearIdleTimer()
    this.disconnectPlaywright()

    if (this.extensionWs?.readyState === WebSocket.OPEN) {
      this.extensionWs.send(JSON.stringify({ method: 'releaseDebug', params: {} }))
    }
  }

  private resetIdleTimer() {
    this.clearIdleTimer()
    if (this.idleTimeoutMs > 0) {
      this.idleTimer = setTimeout(() => {
        console.log(`[cdp-relay] Idle timeout (${this.idleTimeoutMs / 1000}s) — releasing debugging`)
        this.releaseDebugging()
      }, this.idleTimeoutMs)
    }
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  /** Get all Playwright pages via the persistent CDP connection */
  async getPages(): Promise<Page[]> {
    const browser = await this.ensurePlaywrightConnection()
    if (!browser) return []
    return browser.contexts().flatMap((c) => c.pages())
  }

  /** Get a Playwright page, optionally matched by dev server port */
  async getPage(serverPort?: number): Promise<Page | null> {
    const pages = await this.getPages()
    if (!pages.length) return null
    if (!serverPort) return pages[0]

    // Match page URL against the dev server port
    for (const page of pages) {
      try {
        const url = new URL(page.url())
        if (parseInt(url.port) === serverPort) return page
      } catch {}
    }

    // Also check targets — the page URL might be proxied (portless) but the target knows the original
    for (const page of pages) {
      for (const target of this.targets.values()) {
        try {
          const targetUrl = new URL(target.targetInfo.url)
          const pageUrl = new URL(page.url())
          if (targetUrl.hostname === pageUrl.hostname || pageUrl.hostname.endsWith('.localhost')) {
            return page
          }
        } catch {}
      }
    }

    // Fallback to first page
    return pages[0]
  }

  /** Get a CDP session for a page (using getExistingCDPSession, not newCDPSession) */
  async getCDPSession(page: Page): Promise<any> {
    return page.context().getExistingCDPSession(page)
  }

  private async ensurePlaywrightConnection(): Promise<Browser | null> {
    if (this.pwBrowser) return this.pwBrowser
    if (this.pwConnecting) return null
    if (!this.isAvailable) return null

    this.pwConnecting = true
    try {
      const { chromium } = await import('@xmorse/playwright-core')
      this.pwBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${this.gatewayPort}`)
      console.log('[cdp-relay] Playwright connected internally')

      // Clean up on disconnect
      this.pwBrowser.on('disconnected', () => {
        console.log('[cdp-relay] Playwright internal connection lost')
        this.pwBrowser = null
      })

      return this.pwBrowser
    } catch (e: any) {
      console.error('[cdp-relay] Failed to connect Playwright internally:', e.message)
      return null
    } finally {
      this.pwConnecting = false
    }
  }

  private disconnectPlaywright() {
    if (this.pwBrowser) {
      this.pwBrowser.close().catch(() => {})
      this.pwBrowser = null
    }
  }

  // ---- HTTP & WebSocket routing ----

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = request.url || ''

    if (url === '/__cdp-extension') {
      this.extensionWss.handleUpgrade(request, socket, head, (ws) => {
        this.extensionWss.emit('connection', ws, request)
      })
      return true
    }

    if (url.startsWith('/devtools/browser/')) {
      if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
        console.log('[cdp-relay] Playwright tried to connect but no extension available')
        socket.destroy()
        return true
      }
      this.playwrightWss.handleUpgrade(request, socket, head, (ws) => {
        this.playwrightWss.emit('connection', ws, request)
      })
      return true
    }

    return false
  }

  /** Handle CDP control actions. Returns response object or null if not matched. */
  handleAction(url: string): object | null {
    if (url === '/__cdp/release') {
      this.releaseDebugging()
      return { released: true, was_active: this.debuggingActive || this.targets.size > 0 }
    }
    if (url === '/__cdp/status') {
      return {
        debugging_active: this.debuggingActive,
        targets: this.targets.size,
        available_tabs: this.availableTabs.size,
        extension_connected: this.extensionWs?.readyState === WebSocket.OPEN,
        clients: this.clients.size,
        idle_timeout_ms: this.idleTimeoutMs,
      }
    }
    return null
  }

  handleHttp(url: string): object | null {
    const clean = url.replace(/\/$/, '')

    if (clean === '/json/version') {
      return {
        Browser: 'web-dev-mcp/Extension-Bridge',
        'Protocol-Version': '1.3',
        'V8-Version': '',
        'User-Agent': '',
        webSocketDebuggerUrl: `ws://127.0.0.1:${this.gatewayPort}/devtools/browser/web-dev-mcp`,
      }
    }

    if (clean === '/json/list' || clean === '/json') {
      return [...this.targets.values()].map((t) => ({
        id: t.targetInfo.targetId,
        type: t.targetInfo.type,
        url: t.targetInfo.url,
        webSocketDebuggerUrl: `ws://127.0.0.1:${this.gatewayPort}/devtools/page/${t.targetInfo.targetId}`,
      }))
    }

    return null
  }

  // ---- Extension connection ----

  private onExtensionConnect(ws: WebSocket) {
    if (this.extensionWs) {
      console.log('[cdp-relay] Replacing existing extension connection')
      this.extensionWs.close()
    }
    this.extensionWs = ws
    console.log('[cdp-relay] Extension connected')

    ws.on('message', (data) => {
      try {
        this.onExtensionMessage(JSON.parse(data.toString()))
      } catch (e: any) {
        console.error('[cdp-relay] Bad extension message:', e.message)
      }
    })

    ws.on('close', () => {
      console.log('[cdp-relay] Extension disconnected')
      this.extensionWs = null
      this.targets.clear()
      this.availableTabs.clear()
      this.debuggingActive = false
      this.debuggingRequested = false
      this.clearIdleTimer()
      this.disconnectPlaywright()
      // Close all Playwright clients
      for (const client of this.clients.values()) {
        client.ws.close()
      }
      this.clients.clear()
    })
  }

  private onExtensionMessage(msg: any) {
    // Command response — resolve pending promise, do NOT forward to Playwright
    if (msg.id !== undefined && !msg.method) {
      const pending = this.pendingCommands.get(msg.id)
      if (pending) {
        this.pendingCommands.delete(msg.id)
        clearTimeout(pending.timer)
        if (msg.error) {
          pending.reject(new Error(msg.error.message || msg.error))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    if (msg.method === 'pong') return

    // Tab availability announcements
    if (msg.method === 'tabAvailable') {
      const { tabId, url, serverId, projectId } = msg.params
      this.availableTabs.set(tabId, { tabId, url, serverId, projectId })
      console.log(`[cdp-relay] Tab available: ${tabId} url=${url}`)
      return
    }

    if (msg.method === 'tabUnavailable') {
      const { tabId } = msg.params
      this.availableTabs.delete(tabId)
      console.log(`[cdp-relay] Tab unavailable: ${tabId}`)
      return
    }

    // CDP event from extension — update state and forward to subscribed clients
    if (msg.method === 'forwardCDPEvent') {
      const { sessionId, method, params } = msg.params

      // Track target lifecycle with FULL targetInfo
      if (method === 'Target.attachedToTarget') {
        this.targets.set(params.sessionId, {
          sessionId: params.sessionId,
          targetInfo: { ...params.targetInfo },
        })
        this.debuggingActive = true
        console.log(`[cdp-relay] Target attached: ${params.sessionId} url=${params.targetInfo?.url}`)
      } else if (method === 'Target.detachedFromTarget') {
        this.targets.delete(params.sessionId)
        if (this.targets.size === 0) {
          this.debuggingActive = false
        }
        console.log(`[cdp-relay] Target detached: ${params.sessionId}`)
      } else if (method === 'Target.targetInfoChanged' && params.targetInfo) {
        const existing = this.targets.get(sessionId)
        if (existing) {
          existing.targetInfo = { ...existing.targetInfo, ...params.targetInfo }
        }
      }

      // Emit on internal bus (for Runtime.enable wait pattern)
      this.events.emit('cdp:event', { method, params, sessionId })

      // Route to subscribed clients
      const cdpMsg = { method, params, sessionId: sessionId || undefined }

      for (const client of this.clients.values()) {
        if (client.ws.readyState !== WebSocket.OPEN) continue

        if (method === 'Target.attachedToTarget') {
          // Only send to clients subscribed to all targets (via setAutoAttach)
          if (!client.subscribedToAll) continue
          const sid = params.sessionId
          if (client.announcedSessions.has(sid)) continue // dedup
          client.announcedSessions.add(sid)
        } else if (method === 'Target.detachedFromTarget') {
          client.announcedSessions.delete(params.sessionId)
          // Only send to clients that knew about this session
          if (!client.subscribedToAll) continue
        } else {
          // Regular CDP events — route to clients that own this session
          const eventSession = sessionId || params?.sessionId
          if (eventSession && !client.announcedSessions.has(eventSession) && !client.subscribedToAll) continue
        }

        client.ws.send(JSON.stringify(cdpMsg))
      }
    }
  }

  // ---- Playwright client connections ----

  private onPlaywrightConnect(ws: WebSocket) {
    const clientId = `pw-${nextClientId++}`
    const client: PlaywrightClient = {
      ws,
      clientId,
      announcedSessions: new Set(),
      subscribedToAll: false,
    }
    this.clients.set(clientId, client)
    console.log(`[cdp-relay] Playwright client connected: ${clientId} (${this.clients.size} total)`)

    ws.on('message', (data) => {
      try {
        this.onPlaywrightMessage(client, JSON.parse(data.toString()))
      } catch (e: any) {
        console.error(`[cdp-relay] Bad Playwright message from ${clientId}:`, e.message)
      }
    })

    ws.on('close', () => {
      this.clients.delete(clientId)
      console.log(`[cdp-relay] Playwright client disconnected: ${clientId} (${this.clients.size} remaining)`)
    })
  }

  private async onPlaywrightMessage(client: PlaywrightClient, msg: any) {
    const { id, method, params, sessionId } = msg

    try {
      const result = await this.routeCommand(method, params, sessionId)

      // After Target.setAutoAttach: mark client as subscribed and synthesize
      // Target.attachedToTarget for all known targets not yet announced to this client
      if (method === 'Target.setAutoAttach' && !sessionId) {
        client.subscribedToAll = true
        for (const target of this.targets.values()) {
          if (client.announcedSessions.has(target.sessionId)) continue
          client.announcedSessions.add(target.sessionId)
          this.sendToClient(client, {
            method: 'Target.attachedToTarget',
            params: {
              sessionId: target.sessionId,
              targetInfo: { ...target.targetInfo, attached: true },
              waitingForDebugger: false,
            },
          })
        }
      }

      // Track session ownership when client attaches to a target
      if (method === 'Target.attachToTarget' && result?.sessionId) {
        client.announcedSessions.add(result.sessionId)
      }

      this.sendToClient(client, { id, sessionId, result })
    } catch (e: any) {
      this.sendToClient(client, { id, sessionId, error: { message: e.message } })
    }
  }

  // ---- CDP command routing ----

  private async routeCommand(method: string, params: any, sessionId?: string): Promise<any> {
    // For commands that need targets, ensure debugging is active first
    if (!this.debuggingActive && this.canActivate) {
      const needsTargets = [
        'Target.getTargetInfo', 'Target.getTargets', 'Target.attachToTarget',
        'Target.attachToBrowserTarget', 'Target.setAutoAttach', 'Runtime.enable',
      ].includes(method)
      if (needsTargets || sessionId) {
        await this.ensureDebugging()
      }
    }

    switch (method) {
      // --- Handled locally ---

      case 'Browser.getVersion':
        return {
          protocolVersion: '1.3',
          product: 'Chrome/Extension-Bridge',
          revision: '',
          userAgent: '',
          jsVersion: '',
        }

      case 'Browser.setDownloadBehavior':
        return {}

      case 'Target.setDiscoverTargets':
        return {}

      case 'Target.attachToTarget': {
        const target = [...this.targets.values()].find(
          (t) => t.targetInfo.targetId === params?.targetId,
        )
        if (!target) throw new Error(`Target not found: ${params?.targetId}`)
        return { sessionId: target.sessionId }
      }

      case 'Target.getTargetInfo': {
        let target: StoredTarget | undefined
        if (params?.targetId) {
          target = [...this.targets.values()].find(
            (t) => t.targetInfo.targetId === params.targetId,
          )
        } else if (sessionId) {
          target = this.targets.get(sessionId)
        }
        if (!target) {
          target = [...this.targets.values()][0]
        }
        if (!target) throw new Error('No targets available')
        return { targetInfo: target.targetInfo }
      }

      case 'Target.getTargets':
        return {
          targetInfos: [...this.targets.values()].map((t) => ({
            ...t.targetInfo,
            attached: true,
          })),
        }

      case 'Target.attachToBrowserTarget': {
        const t = params?.targetId
          ? [...this.targets.values()].find((t) => t.targetInfo.targetId === params.targetId)
          : [...this.targets.values()][0]
        if (!t) throw new Error('No targets available for browser session')
        return { sessionId: t.sessionId }
      }

      // --- Special handling: forward + post-processing ---

      case 'Target.setAutoAttach': {
        if (sessionId) {
          return this.sendToExtension(method, params, sessionId)
        }
        // Root level: forward to extension (it applies to all tabs), return {}
        this.sendToExtension(method, params).catch(() => {})
        return {}
      }

      case 'Runtime.enable': {
        if (!sessionId) {
          return this.sendToExtension(method, params, sessionId)
        }
        const contextPromise = new Promise<void>((resolve) => {
          const handler = (event: any) => {
            if (
              event.method === 'Runtime.executionContextCreated' &&
              event.sessionId === sessionId &&
              event.params?.context?.auxData?.isDefault === true
            ) {
              clearTimeout(timer)
              this.events.off('cdp:event', handler)
              resolve()
            }
          }
          const timer = setTimeout(() => {
            this.events.off('cdp:event', handler)
            console.log(`[cdp-relay] Runtime.enable: executionContextCreated timeout (3s) for ${sessionId}`)
            resolve()
          }, 3000)
          this.events.on('cdp:event', handler)
        })

        const result = await this.sendToExtension(method, params, sessionId)
        await contextPromise
        return result
      }

      case 'Target.createTarget':
      case 'Target.closeTarget':
        return this.sendToExtension(method, params, sessionId)

      // --- Default: forward to extension ---

      default:
        return this.sendToExtension(method, params, sessionId)
    }
  }

  // ---- Transport helpers ----

  private sendToClient(client: PlaywrightClient, msg: any) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg))
    }
  }

  private sendToExtension(method: string, params: any, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.extensionWs || this.extensionWs.readyState !== WebSocket.OPEN) {
        reject(new Error('Extension not connected'))
        return
      }

      const id = this.nextCommandId++
      const timer = setTimeout(() => {
        this.pendingCommands.delete(id)
        reject(new Error(`Extension command timeout (30s): ${method}`))
      }, 30000)

      this.pendingCommands.set(id, { resolve, reject, timer })

      this.extensionWs.send(JSON.stringify({
        id,
        method: 'forwardCDPCommand',
        params: { sessionId, method, params },
      }))
    })
  }

  close() {
    this.clearIdleTimer()
    this.disconnectPlaywright()
    this.extensionWs?.close()
    for (const client of this.clients.values()) {
      client.ws.close()
    }
    this.clients.clear()
    this.extensionWss.close()
    this.playwrightWss.close()
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Relay closed'))
    }
    this.pendingCommands.clear()
  }
}
