// Next.js adapter for webdev
// Wraps next.config to inject gateway registration, console capture, build events, and rewrites

import {
  ensureGateway,
  registerWithRetry,
  patchConsole,
  connectDevEvents,
  makeServerId,
  type DevEventsHandle,
  type RegistrationPayload,
} from '@winstonfassett/webdev-gateway/helpers'

interface NextConfig {
  webpack?: (config: any, options: any) => any
  rewrites?: () => Promise<any> | any
  [key: string]: any
}

export interface WebdevOptions {
  gatewayUrl?: string
  enabled?: boolean
  network?: boolean
  key?: string              // Optional key for disambiguation
}

let _devEvents: DevEventsHandle | null = null

function sendBuildEvent(payload: any) {
  _devEvents?.send(payload)
}

/** Webpack plugin that sends build events to the gateway */
class WebdevBuildPlugin {
  apply(compiler: any) {
    compiler.hooks.compile.tap('WebdevBuild', () => {
      sendBuildEvent({ type: 'build:start' })
    })

    compiler.hooks.done.tap('WebdevBuild', (stats: any) => {
      if (stats.hasErrors()) {
        const errors = stats.toJson({ errors: true }).errors
        const msg = errors?.[0]?.message ?? 'Build error'
        sendBuildEvent({ type: 'build:error', error: msg })
      } else {
        const modules = Object.keys(stats.toJson({ assets: false, modules: true }).modules ?? {}).slice(0, 20)
        sendBuildEvent({ type: 'build:update', modules, duration: stats.endTime - stats.startTime })
      }
    })
  }
}

export function withWebdev(
  nextConfig: NextConfig = {},
  options: WebdevOptions = {}
): NextConfig {
  const {
    gatewayUrl = 'http://localhost:3333',
    enabled = process.env.NODE_ENV === 'development',
    network = false,
  } = options

  if (!enabled) {
    return nextConfig
  }

  // Stable server ID: computed from directory + type, inherited by forked workers via env
  if (!process.env.__WEBDEV_SERVER__) {
    process.env.__WEBDEV_SERVER__ = makeServerId(process.cwd(), 'nextjs', options.key)
  }
  const serverId = process.env.__WEBDEV_SERVER__

  // Guard: Next.js forks workers that re-run this code. Only register once.
  if (!process.env.__WEBDEV_REGISTERED__) {
    process.env.__WEBDEV_REGISTERED__ = '1'

    const registrationPayload: RegistrationPayload = {
      serverId,
      type: 'nextjs',
      port: parseInt(process.env.PORT || '3000', 10),
      pid: process.pid,
      directory: process.cwd(),
      key: options.key,
    }

    ensureGateway(gatewayUrl).then(async () => {
      await patchConsole(gatewayUrl, serverId)
      _devEvents = await connectDevEvents(gatewayUrl, serverId, {
        registrationPayload,
      })

      registerWithRetry(gatewayUrl, registrationPayload)
    })
  }

  return {
    ...nextConfig,

    // Expose env vars to browser — works with both webpack and Turbopack
    env: {
      ...nextConfig.env,
      NEXT_PUBLIC_WEBDEV_GATEWAY: gatewayUrl,
      NEXT_PUBLIC_WEBDEV_SERVER: serverId,
    },

    webpack(config: any, webpackOptions: any) {
      const { dev, isServer } = webpackOptions

      // Exclude gateway log directory from webpack watching
      if (dev) {
        const existing = config.watchOptions?.ignored
        let ignored: RegExp
        if (existing instanceof RegExp) {
          ignored = new RegExp(existing.source + '|[/\\\\]\\.webdev[/\\\\]')
        } else {
          ignored = /[/\\]\.webdev[/\\]/
        }
        config.watchOptions = { ...config.watchOptions, ignored }

        config.plugins = config.plugins || []
        config.plugins.push(new WebdevBuildPlugin())
      }

      // Inject client instrumentation in dev client bundles (webpack mode only)
      if (dev && !isServer) {
        const originalEntry = config.entry

        config.entry = async () => {
          const entries = await originalEntry()

          Object.keys(entries).forEach((key) => {
            const entry = entries[key]
            if (Array.isArray(entry) && !entry.includes('@winstonfassett/webdev-next/instrument')) {
              entries[key] = ['@winstonfassett/webdev-next/instrument', ...entry]
            }
          })

          return entries
        }

        config.plugins = config.plugins || []
        const webpack = config.plugins[0]?.constructor
        if (webpack && webpack.DefinePlugin) {
          config.plugins.push(
            new webpack.DefinePlugin({
              'process.env.__WEBDEV_GATEWAY__': JSON.stringify(gatewayUrl),
              'process.env.__WEBDEV_NETWORK__': JSON.stringify(network),
              'process.env.__WEBDEV_SERVER__': JSON.stringify(serverId),
            })
          )
        }
      }

      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, webpackOptions)
      }

      return config
    },

    async rewrites() {
      const userRewrites =
        typeof nextConfig.rewrites === 'function'
          ? await nextConfig.rewrites()
          : { beforeFiles: [], afterFiles: [], fallback: [] }

      const normalized = Array.isArray(userRewrites)
        ? { beforeFiles: userRewrites, afterFiles: [], fallback: [] }
        : userRewrites

      const mcpRewrites = [
        { source: '/__mcp/:path*', destination: `${gatewayUrl}/__mcp/:path*` },
        { source: '/__rpc', destination: `${gatewayUrl}/__rpc` },
        { source: '/__events', destination: `${gatewayUrl}/__events` },
        { source: '/__webdev.js', destination: `${gatewayUrl}/__webdev.js` },
        { source: '/__libs/:path*', destination: `${gatewayUrl}/__libs/:path*` },
        { source: '/__element-grab.js', destination: `${gatewayUrl}/__element-grab.js` },
      ]

      return {
        beforeFiles: [...(normalized.beforeFiles || []), ...mcpRewrites],
        afterFiles: normalized.afterFiles || [],
        fallback: normalized.fallback || [],
      }
    },
  }
}
