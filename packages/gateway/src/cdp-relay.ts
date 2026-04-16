/**
 * CDP Relay — bridges between Playwright and the Chrome extension.
 *
 * Based on Playwriter's proven relay pattern (github.com/remorses/playwriter).
 * Stripped to essentials: no multi-extension, no recording, no Ghost Browser.
 *
 * WebSocket endpoints:
 *   /__cdp-extension     — extension connects here
 *   /devtools/browser/*  — Playwright connects here via connectOverCDP
 *
 * HTTP endpoints (Playwright discovery):
 *   /json/version   — browser info with rewritten webSocketDebuggerUrl
 *   /json/list      — list of attached targets
 *
 * Protocol (extension ↔ relay):
 *   EXT→RELAY events:   { method: 'forwardCDPEvent', params: { sessionId, method, params } }
 *   EXT→RELAY responses: { id, result } or { id, error }
 *   RELAY→EXT commands:  { id, method: 'forwardCDPCommand', params: { sessionId, method, params } }
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

export interface CDPRelayOptions {
  gatewayPort: number
}

interface StoredTarget {
  sessionId: string
  targetInfo: any // Full CDP TargetInfo as received from extension — never reconstruct
}

export class CDPRelay {
  private extensionWs: WebSocket | null = null
  private playwrightWs: WebSocket | null = null
  private extensionWss: WebSocketServer
  private playwrightWss: WebSocketServer
  private targets = new Map<string, StoredTarget>()
  private pendingCommands = new Map<number, {
    resolve: (v: any) => void
    reject: (e: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private nextCommandId = 1
  private gatewayPort: number
  private events = new EventEmitter() // Internal event bus for Runtime.enable wait pattern

  constructor(options: CDPRelayOptions) {
    this.gatewayPort = options.gatewayPort
    this.extensionWss = new WebSocketServer({ noServer: true })
    this.playwrightWss = new WebSocketServer({ noServer: true })
    this.extensionWss.on('connection', (ws) => this.onExtensionConnect(ws))
    this.playwrightWss.on('connection', (ws) => this.onPlaywrightConnect(ws))
  }

  get isAvailable(): boolean {
    return this.extensionWs?.readyState === WebSocket.OPEN && this.targets.size > 0
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
      this.playwrightWs?.close()
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

    // CDP event from extension — update state and forward to Playwright
    if (msg.method === 'forwardCDPEvent') {
      const { sessionId, method, params } = msg.params

      // Track target lifecycle with FULL targetInfo
      if (method === 'Target.attachedToTarget') {
        this.targets.set(params.sessionId, {
          sessionId: params.sessionId,
          targetInfo: { ...params.targetInfo },
        })
        console.log(`[cdp-relay] Target attached: ${params.sessionId} url=${params.targetInfo?.url}`)
      } else if (method === 'Target.detachedFromTarget') {
        this.targets.delete(params.sessionId)
        console.log(`[cdp-relay] Target detached: ${params.sessionId}`)
      } else if (method === 'Target.targetInfoChanged' && params.targetInfo) {
        const existing = this.targets.get(sessionId)
        if (existing) {
          existing.targetInfo = { ...existing.targetInfo, ...params.targetInfo }
        }
      }

      // Emit on internal bus (for Runtime.enable wait pattern)
      this.events.emit('cdp:event', { method, params, sessionId })

      // Forward to Playwright
      this.sendToPlaywright({ method, params, sessionId: sessionId || undefined })
    }
  }

  // ---- Playwright connection ----

  private onPlaywrightConnect(ws: WebSocket) {
    if (this.playwrightWs) {
      console.log('[cdp-relay] Replacing existing Playwright connection')
      this.playwrightWs.close()
    }
    this.playwrightWs = ws
    console.log('[cdp-relay] Playwright connected')

    ws.on('message', (data) => {
      try {
        this.onPlaywrightMessage(JSON.parse(data.toString()))
      } catch (e: any) {
        console.error('[cdp-relay] Bad Playwright message:', e.message)
      }
    })

    ws.on('close', () => {
      console.log('[cdp-relay] Playwright disconnected')
      this.playwrightWs = null
    })
  }

  private async onPlaywrightMessage(msg: any) {
    const { id, method, params, sessionId } = msg

    try {
      const result = await this.routeCommand(method, params, sessionId)

      // Post-response actions (matching Playwriter's pattern)

      // After Target.setAutoAttach: synthesize Target.attachedToTarget for all known targets
      if (method === 'Target.setAutoAttach' && !sessionId) {
        for (const target of this.targets.values()) {
          this.sendToPlaywright({
            method: 'Target.attachedToTarget',
            params: {
              sessionId: target.sessionId,
              targetInfo: { ...target.targetInfo, attached: true },
              waitingForDebugger: false,
            },
          })
        }
      }

      this.sendToPlaywright({ id, sessionId, result })
    } catch (e: any) {
      this.sendToPlaywright({ id, sessionId, error: { message: e.message } })
    }
  }

  // ---- CDP command routing ----

  private async routeCommand(method: string, params: any, sessionId?: string): Promise<any> {
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
        // Browser-level CDP session — return first available target's session
        const t = params?.targetId
          ? [...this.targets.values()].find((t) => t.targetInfo.targetId === params.targetId)
          : [...this.targets.values()][0]
        if (!t) throw new Error('No targets available for browser session')
        return { sessionId: t.sessionId }
      }

      // --- Special handling: forward + post-processing ---

      case 'Target.setAutoAttach': {
        if (sessionId) {
          // Child session: just forward
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
        // Wait for executionContextCreated with isDefault=true after forwarding
        // This is critical — Playwright blocks until it gets a default execution context
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

  private sendToPlaywright(msg: any) {
    if (this.playwrightWs?.readyState === WebSocket.OPEN) {
      this.playwrightWs.send(JSON.stringify(msg))
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
    this.extensionWs?.close()
    this.playwrightWs?.close()
    this.extensionWss.close()
    this.playwrightWss.close()
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Relay closed'))
    }
    this.pendingCommands.clear()
  }
}
