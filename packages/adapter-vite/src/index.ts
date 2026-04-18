// Vite adapter for web-dev-mcp
// Injects client code via Vite's transform hook, forwards HMR/build events to gateway

import type { Plugin, HotUpdateOptions, EnvironmentModuleNode, ResolvedConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureGateway,
  registerWithRetry,
  patchConsole,
  connectDevEvents,
  makeServerId,
  type RegistrationPayload,
  type DevEventsHandle,
  type ConnectDevEventsOptions,
} from '@winstonfassett/web-dev-mcp-gateway/helpers'

export interface ViteAdapterOptions {
  gateway?: string // Gateway URL, default: http://localhost:3333
  serverType?: 'vite' | 'storybook' | 'generic'
  key?: string     // Optional key for disambiguation (e.g. two vite configs in same dir)
}

export function webDevMcp(options: ViteAdapterOptions = {}): Plugin {
  const gatewayUrl = options.gateway ?? 'http://localhost:3333'
  let clientSource: string | undefined
  let devEvents: DevEventsHandle | null = null
  let serverId: string | null = null
  let resolvedConfig: ResolvedConfig | null = null

  return {
    name: 'web-dev-mcp',
    apply: 'serve',

    configResolved(config) {
      resolvedConfig = config
      const serverType = options.serverType ?? 'vite'
      serverId = makeServerId(config.root, serverType, options.key)
      ;(config.server as any).forwardConsole = false
    },

    async configureServer(server) {
      // Auto-start gateway if not running
      await ensureGateway(gatewayUrl)

      // Start console capture immediately
      await patchConsole(gatewayUrl, serverId!)

      // Register with gateway (retry loop)
      const payload: RegistrationPayload = {
        serverId: serverId!,
        type: options.serverType ?? 'vite',
        port: resolvedConfig!.server.port ?? 5173,
        pid: process.pid,
        directory: resolvedConfig!.root,
        key: options.key,
      }
      registerWithRetry(gatewayUrl, payload)

      // Connect dev events WebSocket (with re-registration on reconnect)
      devEvents = await connectDevEvents(gatewayUrl, serverId!, {
        registrationPayload: payload,
      })

      // Serve gateway's bundled client.js at /__web-dev-mcp.js
      const clientPath = resolveClientPath()
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/__web-dev-mcp.js') {
          if (!clientSource) {
            clientSource = readFileSync(clientPath, 'utf-8')
          }
          res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' })
          res.end(clientSource)
          return
        }
        next()
      })
    },

    transformIndexHtml() {
      // Inject meta tag via JS to ensure it works with SSR frameworks (TanStack Start, etc.)
      // that re-render <head> and may drop statically injected meta tags.
      let initScript = `window.__WEB_DEV_MCP_ORIGIN__ = ${JSON.stringify(gatewayUrl)};`
      if (serverId) {
        initScript += `\nwindow.__WEB_DEV_MCP_SERVER__ = ${JSON.stringify(serverId)};`
      }
      initScript += `\n;(function(){var m=document.createElement('meta');m.name='web-dev-mcp';m.content=${JSON.stringify(gatewayUrl)};`
      if (serverId) {
        initScript += `m.setAttribute('data-server-id',${JSON.stringify(serverId)});`
      }
      initScript += `document.head.appendChild(m)})()`
      // Load client script from vite's own origin (not gateway) so it works on remote devices
      initScript += `\n;(function(){var s=document.createElement('script');s.src='/__web-dev-mcp.js';document.head.appendChild(s)})()`

      return [
        { tag: 'script', children: initScript, injectTo: 'head-prepend' as const },
      ]
    },

    hotUpdate(opts: HotUpdateOptions) {
      if (opts.modules.length > 0) {
        devEvents?.send({
          type: 'build:update',
          modules: opts.modules.map((m: EnvironmentModuleNode) => m.id ?? m.url),
        })
      }
    },
  }
}

function resolveClientPath(): string {
  // client.js is bundled in the gateway package's dist/
  try {
    const gatewayPkg = import.meta.resolve('@winstonfassett/web-dev-mcp-gateway')
    const gatewayDir = new URL('.', gatewayPkg).pathname
    return join(gatewayDir, 'web-dev-mcp-client.js')
  } catch {
    // Fallback for workspace/linked setups
    return join(process.cwd(), 'node_modules', '@winstonfassett', 'web-dev-mcp-gateway', 'dist', 'web-dev-mcp-client.js')
  }
}
