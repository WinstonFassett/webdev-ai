// Vite adapter for webdev
// Injects client code via Vite's transform hook, forwards HMR/build events to gateway

/// <reference types="@vitejs/devtools-kit" />
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
} from '@winstonfassett/webdev-gateway/helpers'

export interface ViteAdapterOptions {
  gateway?: string // Gateway URL, default: http://localhost:3333
  serverType?: 'vite' | 'storybook' | 'astro' | 'generic'
  key?: string     // Optional key for disambiguation (e.g. two vite configs in same dir)
}

export function webdev(options: ViteAdapterOptions = {}): Plugin {
  const gatewayUrl = options.gateway ?? 'http://localhost:3333'
  let clientSource: string | undefined
  let devEvents: DevEventsHandle | null = null
  let serverId: string | null = null
  let resolvedConfig: ResolvedConfig | null = null

  return {
    name: 'webdev',
    apply: 'serve',

    config() {
      return {
        server: {
          watch: {
            ignored: ['**/.webdev/**'],
          },
        },
      }
    },

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

      // Serve gateway's bundled client.js at /__webdev.js
      const clientPath = resolveClientPath()
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url === '/__webdev.js') {
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
      let initScript = `window.__WEBDEV_ORIGIN__ = ${JSON.stringify(gatewayUrl)};`
      if (serverId) {
        initScript += `\nwindow.__WEBDEV_SERVER__ = ${JSON.stringify(serverId)};`
      }
      initScript += `\n;(function(){var m=document.createElement('meta');m.name='webdev';m.content=${JSON.stringify(gatewayUrl)};`
      if (serverId) {
        initScript += `m.setAttribute('data-server-id',${JSON.stringify(serverId)});`
      }
      initScript += `document.head.appendChild(m)})()`
      // Load client script from vite's own origin (not gateway) so it works on remote devices
      initScript += `\n;(function(){var s=document.createElement('script');s.src='/__webdev.js';document.head.appendChild(s)})()`

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

    devtools: {
      setup(ctx) {
        const params = new URLSearchParams({ embed: 'dock' })
        if (serverId) params.set('server', serverId)
        ctx.docks.register({
          id: 'webdev-ai',
          title: 'webdev-ai',
          icon: 'ph:robot-duotone',
          type: 'iframe',
          url: `${gatewayUrl}/__admin?${params.toString()}`,
        })
        ctx.docks.register({
          id: 'webdev-element-grab',
          title: 'Element picker',
          icon: 'ph:cursor-duotone',
          type: 'action',
          action: {
            importFrom: '@winstonfassett/webdev-vite/devtools-element-grab',
          },
        })
      },
    },
  }
}

function resolveClientPath(): string {
  // client.js is bundled in the gateway package's dist/
  try {
    const gatewayPkg = import.meta.resolve('@winstonfassett/webdev-gateway')
    const gatewayDir = new URL('.', gatewayPkg).pathname
    return join(gatewayDir, 'webdev-client.js')
  } catch {
    // Fallback for workspace/linked setups
    return join(process.cwd(), 'node_modules', '@winstonfassett', 'webdev-gateway', 'dist', 'webdev-client.js')
  }
}
