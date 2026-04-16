/**
 * CDP Relay — bridges between Playwright and the Chrome extension.
 *
 * Two WebSocket endpoints on the gateway:
 *   /__cdp-extension  — extension connects here, sends/receives CDP messages
 *   /devtools/browser/* — Playwright connects here via connectOverCDP
 *
 * HTTP endpoints for Playwright discovery:
 *   /json/version — returns browser info with rewritten webSocketDebuggerUrl
 *   /json/list — returns list of attached targets
 *
 * Message protocol:
 *   Extension → Relay:
 *     { method: 'forwardCDPEvent', params: { sessionId, method, params } }
 *     { id, result } or { id, error }  (command responses)
 *
 *   Relay → Extension:
 *     { id, method: 'forwardCDPCommand', params: { sessionId, method, params } }
 *     { method: 'ping' }
 */

import { WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

export interface CDPRelayOptions {
  /** Port the gateway is listening on (for rewriting webSocketDebuggerUrl) */
  gatewayPort: number
}

interface TargetInfo {
  targetId: string
  sessionId: string
  type: string
  url: string
  attached: boolean
}

export class CDPRelay {
  private extensionWs: WebSocket | null = null
  private playwrightWs: WebSocket | null = null
  private extensionWss: WebSocketServer
  private playwrightWss: WebSocketServer
  private targets = new Map<string, TargetInfo>() // sessionId → target
  private pendingCommands = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private nextCommandId = 1
  private gatewayPort: number

  constructor(options: CDPRelayOptions) {
    this.gatewayPort = options.gatewayPort
    this.extensionWss = new WebSocketServer({ noServer: true })
    this.playwrightWss = new WebSocketServer({ noServer: true })

    this.extensionWss.on('connection', (ws) => this.onExtensionConnect(ws))
    this.playwrightWss.on('connection', (ws) => this.onPlaywrightConnect(ws))
  }

  /** Whether the extension is connected and has at least one attached target */
  get isAvailable(): boolean {
    return this.extensionWs?.readyState === WebSocket.OPEN && this.targets.size > 0
  }

  /** Handle HTTP upgrade requests — route to extension or playwright WSS */
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
        console.log('[cdp-relay] Playwright tried to connect but no extension is connected')
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

  /** Handle HTTP requests for CDP discovery endpoints */
  handleHttp(url: string): object | null {
    const cleanUrl = url.replace(/\/$/, '')

    if (cleanUrl === '/json/version') {
      return {
        Browser: 'web-dev-mcp/Extension-Bridge',
        'Protocol-Version': '1.3',
        'V8-Version': '',
        'User-Agent': '',
        webSocketDebuggerUrl: `ws://127.0.0.1:${this.gatewayPort}/devtools/browser/web-dev-mcp`,
      }
    }

    if (cleanUrl === '/json/list' || cleanUrl === '/json') {
      return [...this.targets.values()].map((t) => ({
        id: t.targetId,
        type: t.type,
        url: t.url,
        webSocketDebuggerUrl: `ws://127.0.0.1:${this.gatewayPort}/devtools/page/${t.targetId}`,
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
        const msg = JSON.parse(data.toString())
        this.onExtensionMessage(msg)
      } catch (e) {
        console.error('[cdp-relay] Failed to parse extension message:', e)
      }
    })

    ws.on('close', () => {
      console.log('[cdp-relay] Extension disconnected')
      this.extensionWs = null
      this.targets.clear()
      // Notify Playwright that all targets are gone
      if (this.playwrightWs?.readyState === WebSocket.OPEN) {
        this.playwrightWs.close()
      }
    })
  }

  private onExtensionMessage(msg: any) {
    // CDP event from extension
    if (msg.method === 'forwardCDPEvent') {
      const { sessionId, method, params } = msg.params

      // Track target lifecycle
      if (method === 'Target.attachedToTarget') {
        const { targetInfo } = params
        this.targets.set(params.sessionId, {
          targetId: targetInfo.targetId,
          sessionId: params.sessionId,
          type: targetInfo.type || 'page',
          url: targetInfo.url || '',
          attached: true,
        })
        console.log(`[cdp-relay] Target attached: ${params.sessionId} (${targetInfo.url})`)
      } else if (method === 'Target.detachedFromTarget') {
        this.targets.delete(params.sessionId)
        console.log(`[cdp-relay] Target detached: ${params.sessionId}`)
      } else if (method === 'Target.targetInfoChanged') {
        const existing = this.targets.get(sessionId)
        if (existing && params.targetInfo) {
          existing.url = params.targetInfo.url || existing.url
        }
      }

      // Forward to Playwright as a regular CDP event
      this.sendToPlaywright({
        method,
        params,
        sessionId: sessionId || undefined,
      })
      return
    }

    // Command response from extension
    if (msg.id !== undefined) {
      const pending = this.pendingCommands.get(msg.id)
      if (pending) {
        this.pendingCommands.delete(msg.id)
        clearTimeout(pending.timer)
        if (msg.error) {
          pending.reject(new Error(msg.error.message || 'Extension command failed'))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }

    // Pong
    if (msg.method === 'pong') return
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
        const msg = JSON.parse(data.toString())
        this.onPlaywrightMessage(msg)
      } catch (e) {
        console.error('[cdp-relay] Failed to parse Playwright message:', e)
      }
    })

    ws.on('close', () => {
      console.log('[cdp-relay] Playwright disconnected')
      this.playwrightWs = null
    })
  }

  private async onPlaywrightMessage(msg: any) {
    const { id, method, params, sessionId } = msg

    // Handle locally: Browser.getVersion
    if (method === 'Browser.getVersion') {
      this.sendToPlaywright({
        id,
        result: {
          product: 'Chrome/Extension-Bridge',
          protocolVersion: '1.3',
          revision: '',
          userAgent: '',
          jsVersion: '',
        },
      })
      return
    }

    // Handle locally: Target.setDiscoverTargets
    if (method === 'Target.setDiscoverTargets') {
      this.sendToPlaywright({ id, result: {} })
      // Send existing targets
      for (const target of this.targets.values()) {
        this.sendToPlaywright({
          method: 'Target.targetCreated',
          params: {
            targetInfo: {
              targetId: target.targetId,
              type: target.type,
              title: '',
              url: target.url,
              attached: target.attached,
            },
          },
        })
      }
      return
    }

    // Handle locally: Target.getTargets
    if (method === 'Target.getTargets') {
      this.sendToPlaywright({
        id,
        result: {
          targetInfos: [...this.targets.values()].map((t) => ({
            targetId: t.targetId,
            type: t.type,
            title: '',
            url: t.url,
            attached: t.attached,
          })),
        },
      })
      return
    }

    // Handle locally: Target.getTargetInfo
    if (method === 'Target.getTargetInfo') {
      const target = [...this.targets.values()].find((t) => t.targetId === params?.targetId)
      if (target) {
        this.sendToPlaywright({
          id,
          result: {
            targetInfo: {
              targetId: target.targetId,
              type: target.type,
              title: '',
              url: target.url,
              attached: target.attached,
            },
          },
        })
      } else {
        this.sendToPlaywright({ id, error: { message: `Target not found: ${params?.targetId}` } })
      }
      return
    }

    // Handle locally: Target.attachToTarget
    if (method === 'Target.attachToTarget') {
      const target = [...this.targets.values()].find((t) => t.targetId === params?.targetId)
      if (target) {
        this.sendToPlaywright({
          id,
          result: { sessionId: target.sessionId },
        })
      } else {
        this.sendToPlaywright({ id, error: { message: `Target not found: ${params?.targetId}` } })
      }
      return
    }

    // Handle locally: Browser.setDownloadBehavior
    if (method === 'Browser.setDownloadBehavior') {
      this.sendToPlaywright({ id, result: {} })
      return
    }

    // Everything else: forward to extension
    try {
      const result = await this.sendToExtension(method, params || {}, sessionId)
      this.sendToPlaywright({ id, result })
    } catch (e: any) {
      this.sendToPlaywright({ id, error: { message: e.message } })
    }
  }

  // ---- Send helpers ----

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
        reject(new Error(`Extension command timeout: ${method}`))
      }, 30000)

      this.pendingCommands.set(id, { resolve, reject, timer })

      this.extensionWs.send(JSON.stringify({
        id,
        method: 'forwardCDPCommand',
        params: { sessionId, method, params },
      }))
    })
  }

  /** Clean up */
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
