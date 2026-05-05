// Core MCP tools: browser_connect, browser_disconnect, browser_list, browser_projects,
// browser_eval, browser_screenshot, browser_a11y_snapshot, browser_query, browser_debug, logs

import { z } from 'zod'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import type { RegisteredServer } from './registry.js'
import { truncateChannelFiles } from './session.js'
import { getDiagnostics, queryLogs } from './log-reader.js'
import { browserCommand, getAllBrowsers } from './rpc-server.js'
import { tryPlaywrightCommand } from './playwright-commands.js'

// --- Project/Server Resolution ---

/**
 * Resolve a project target to a server. Accepts:
 *   - server ID (projectId:type)
 *   - projectId (basename-hash4) — picks first server
 *   - full directory path — picks first server
 *   - undefined — uses session currentServer, or auto if only one
 */
function resolveServer(ctx: McpContext, target?: string): RegisteredServer | null {
  const registry = ctx.registry
  if (!registry) return null

  const lookupTarget = target ?? ctx.currentServer ?? ctx.currentProject

  if (lookupTarget) {
    // Try exact server ID match
    let server = registry.get(lookupTarget)
    if (server) return server

    // Try directory match
    let servers = registry.getByDirectory(lookupTarget)
    if (servers.length > 0) return servers[0]

    // Try projectId match
    servers = registry.getByProjectId(lookupTarget)
    if (servers.length > 0) return servers[0]

    // Try parent/child directory match
    for (const s of registry.getAll()) {
      if (s.directory.startsWith(lookupTarget + '/') || lookupTarget.startsWith(s.directory + '/')) {
        return s
      }
    }

    return null
  }

  // No target — auto-resolve if exactly one server
  if (registry.size() === 1) {
    return registry.getAll()[0]
  }

  return null
}

function getLogPaths(ctx: McpContext, projectArg?: string): Record<string, string> {
  const server = resolveServer(ctx, projectArg)
  return server?.logPaths ?? ctx.session.files
}

function errResult(err: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
}

function jsonResult(data: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

/** Send a command to the session's locked browser. Tries Playwright (CDP) first, falls back to RPC. */
async function cmd(ctx: McpContext, method: string, params?: any) {
  const server = resolveServer(ctx)
  const serverPort = server?.endpoints[0]?.port

  const pwResult = await tryPlaywrightCommand(ctx.cdpRelay, method, params, serverPort)
  if (pwResult !== null) return pwResult

  return browserCommand({ browserId: ctx.currentBrowser, serverId: ctx.currentServer }, method, params)
}

// Re-export for full tools
export { resolveServer, getLogPaths, errResult, jsonResult, cmd }

// --- Tool Registration ---

export function registerCoreTools(mcp: McpServer, ctx: McpContext) {

  // --- browser_connect ---
  mcp.tool(
    'browser_connect',
    'Connect to a browser for this session. Locks the session to a specific server and browser. Required before using browser commands when multiple projects are registered.',
    {
      project: z.string().optional().describe('Project: server ID (projectId:type), projectId, or directory path'),
      browser: z.string().optional().describe('Browser ID to connect to. Default: latest browser for the server.'),
    },
    async (args) => {
      const registry = ctx.registry
      if (!registry) {
        return errResult(new Error('No server registry available'))
      }

      // Resolve server
      const server = resolveServer(ctx, args.project)
      if (!server) {
        const all = registry.getAll()
        if (all.length === 0) {
          return errResult(new Error('No dev servers registered. Start a dev server with the webdev adapter.'))
        }
        if (all.length > 1 && !args.project) {
          return jsonResult({
            error: 'Multiple servers registered. Specify a project.',
            servers: all.map(s => ({
              id: s.id,
              projectId: s.projectId,
              directory: s.directory,
              type: s.type,
              endpoints: s.endpoints,
              browsers: getAllBrowsers().filter(b => b.serverId === s.id).length,
            })),
          })
        }
        return errResult(new Error(`No server found matching "${args.project}"`))
      }

      // Lock server
      ctx.currentProject = server.directory
      ctx.currentServer = server.id

      // Find browser
      const serverBrowsers = getAllBrowsers().filter(b => b.serverId === server.id)
      let browser: typeof serverBrowsers[0] | undefined

      if (args.browser) {
        browser = serverBrowsers.find(b => b.browserId === args.browser)
        if (!browser) {
          return jsonResult({
            error: `Browser "${args.browser}" not found for server ${server.id}`,
            available: serverBrowsers.map(b => ({ id: b.browserId, url: b.url, title: b.title })),
          })
        }
      } else {
        // Latest browser
        browser = serverBrowsers[serverBrowsers.length - 1]
      }

      if (browser?.browserId) {
        ctx.currentBrowser = browser.browserId
      }

      // CDP status
      const cdpStatus = ctx.cdpRelay ? {
        available: ctx.cdpRelay.canActivate,
        active: ctx.cdpRelay.isAvailable,
      } : { available: false, active: false }

      return jsonResult({
        server: {
          id: server.id,
          projectId: server.projectId,
          directory: server.directory,
          type: server.type,
          name: server.name,
          endpoints: server.endpoints,
        },
        browser: browser ? {
          id: browser.browserId,
          url: browser.url,
          title: browser.title,
        } : null,
        other_browsers: Math.max(0, serverBrowsers.length - 1),
        cdp: cdpStatus,
      })
    },
  )

  // --- browser_disconnect ---
  mcp.tool(
    'browser_disconnect',
    'Disconnect from the current browser session. Clears server and browser locks.',
    {},
    async () => {
      const prev = { server: ctx.currentServer, browser: ctx.currentBrowser }
      ctx.currentServer = undefined
      ctx.currentBrowser = undefined
      ctx.currentProject = undefined
      return jsonResult({ disconnected: true, previous: prev })
    },
  )

  // --- browser_list ---
  mcp.tool(
    'browser_list',
    'List all connected browsers, optionally filtered by server.',
    {
      server: z.string().optional().describe('Server ID to filter by'),
    },
    async (args) => {
      const allBrowsers = getAllBrowsers()
      const browsers = args.server
        ? allBrowsers.filter(b => b.serverId === args.server)
        : allBrowsers

      const result = browsers.map(b => {
        const server = b.serverId && ctx.registry ? ctx.registry.get(b.serverId) : undefined
        return {
          id: b.browserId,
          connId: b.connId,
          server: b.serverId,
          project: server?.projectId ?? null,
          directory: server?.directory ?? null,
          url: b.url,
          title: b.title,
          connectedAt: b.connectedAt,
          current: b.browserId === ctx.currentBrowser,
        }
      })

      return jsonResult({
        browsers: result,
        current_server: ctx.currentServer ?? null,
        current_browser: ctx.currentBrowser ?? null,
      })
    },
  )

  // --- browser_projects ---
  mcp.tool(
    'browser_projects',
    'List all registered dev server projects.',
    {},
    async () => {
      const projects: any[] = []

      if (ctx.registry) {
        const browsers = getAllBrowsers()
        for (const server of ctx.registry.getAll()) {
          const browserCount = browsers.filter(b => b.serverId === server.id).length
          projects.push({
            id: server.id,
            projectId: server.projectId,
            directory: server.directory,
            type: server.type,
            name: server.name,
            endpoints: server.endpoints,
            browsers: browserCount,
            current: ctx.currentServer === server.id,
          })
        }
      }

      return jsonResult({
        projects,
        current_server: ctx.currentServer ?? null,
      })
    },
  )

  // --- browser_debug ---
  mcp.tool(
    'browser_debug',
    'Start or stop CDP debugging via the Chrome extension. When active, browser commands use Playwright for pixel-perfect screenshots and ref-based element targeting.',
    {
      action: z.enum(['start', 'stop', 'status']).describe('Start/stop CDP debugging, or check status'),
    },
    async (args) => {
      const relay = ctx.cdpRelay
      if (!relay) {
        return jsonResult({ error: 'CDP relay not available. Chrome extension not connected.' })
      }

      if (args.action === 'status') {
        return jsonResult({
          available: relay.canActivate,
          active: relay.isAvailable,
        })
      }

      if (args.action === 'start') {
        if (!relay.canActivate) {
          return jsonResult({ error: 'Cannot activate debugging. Chrome extension not connected or no tabs detected.' })
        }
        const activated = await relay.ensureDebugging()
        return jsonResult({ active: activated })
      }

      if (args.action === 'stop') {
        relay.releaseDebugging()
        return jsonResult({ active: false })
      }

      return errResult(new Error(`Unknown action: ${args.action}`))
    },
  )

  // --- browser_eval ---
  mcp.tool(
    'browser_eval',
    'Run JavaScript in the connected browser. Full DOM access, supports await. Persistent `state` object across calls. `browser.*` helpers available.',
    {
      code: z.union([z.string(), z.array(z.string())]).describe('JavaScript code. Array = auto-waited pipeline (DOM settles between steps). Promises auto-awaited.'),
      project: z.string().optional().describe('Override project for this call'),
    },
    async (args) => {
      try {
        if (!ctx.currentServer && !args.project) {
          // Try auto-resolve
          const server = resolveServer(ctx)
          if (!server) {
            return errResult(new Error('No browser connected. Call browser_connect first.'))
          }
          ctx.currentServer = server.id
          ctx.currentProject = server.directory
        }

        const start = Date.now()
        let result = await cmd(ctx, 'eval', { code: args.code })

        // Intercept screenshot results from browser.screenshot()
        let parsed = result
        if (typeof result === 'string' && result.includes('data:image/')) {
          try { parsed = JSON.parse(result) } catch {}
        }
        if (parsed && typeof parsed === 'object' && typeof (parsed as any).data === 'string'
            && (parsed as any).data.startsWith('data:image/')) {
          const data = (parsed as any).data as string
          const mimeType = data.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
          const base64 = data.replace(/^data:image\/\w+;base64,/, '')
          const server = resolveServer(ctx, args.project)
          const logDir = server?.logDir ?? ctx.session.logDir
          const screenshotDir = join(logDir, 'screenshots')
          const { mkdirSync, writeFileSync } = await import('node:fs')
          mkdirSync(screenshotDir, { recursive: true })
          const filename = `screenshot-${Date.now()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`
          const filepath = join(screenshotDir, filename)
          writeFileSync(filepath, Buffer.from(base64, 'base64'))
          result = JSON.stringify({ screenshot: filepath, width: (parsed as any).width, height: (parsed as any).height })
        }

        const serialized = typeof result === 'string' ? result
          : result === undefined ? 'undefined'
          : result === null ? 'null'
          : JSON.stringify(result, null, 2)

        return jsonResult({ result: serialized, duration_ms: Date.now() - start })
      } catch (err: any) {
        return errResult(err)
      }
    },
  )

  // --- browser_screenshot ---
  mcp.tool(
    'browser_screenshot',
    'Take a screenshot of the connected browser page.',
    {
      selector: z.string().optional().describe('CSS selector to screenshot. Default: full page.'),
      preset: z.enum(['full', 'viewport']).optional().describe('full = full page, viewport = visible area'),
      format: z.enum(['jpeg', 'png']).optional().describe('Image format. Default: jpeg.'),
    },
    async (args) => {
      try {
        const result = await cmd(ctx, 'screenshot', args)
        if (result && typeof result === 'object' && (result as any).data) {
          const data = (result as any).data as string
          const mimeType = data.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
          const base64 = data.replace(/^data:image\/\w+;base64,/, '')
          const server = resolveServer(ctx)
          const logDir = server?.logDir ?? ctx.session.logDir
          const screenshotDir = join(logDir, 'screenshots')
          const { mkdirSync, writeFileSync } = await import('node:fs')
          mkdirSync(screenshotDir, { recursive: true })
          const filename = `screenshot-${Date.now()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`
          const filepath = join(screenshotDir, filename)
          writeFileSync(filepath, Buffer.from(base64, 'base64'))
          return jsonResult({ screenshot: filepath, width: (result as any).width, height: (result as any).height })
        }
        return jsonResult(result)
      } catch (err: any) {
        return errResult(err)
      }
    },
  )

  // --- browser_a11y_snapshot ---
  mcp.tool(
    'browser_a11y_snapshot',
    'Get an accessibility tree snapshot of the page. Interactive elements get ref IDs for use with click/fill (ref=eN).',
    {},
    async () => {
      try {
        const result = await cmd(ctx, 'a11ySnapshot')
        return jsonResult(result)
      } catch (err: any) {
        return errResult(err)
      }
    },
  )

  // --- browser_query ---
  mcp.tool(
    'browser_query',
    'Query the DOM. Returns matching elements with attributes and text content.',
    {
      selector: z.string().describe('CSS selector'),
      visible_only: z.boolean().optional().describe('Only return visible elements. Default: true.'),
    },
    async (args) => {
      try {
        const result = await cmd(ctx, 'queryDom', { selector: args.selector, visibleOnly: args.visible_only ?? true })
        return jsonResult(result)
      } catch (err: any) {
        return errResult(err)
      }
    },
  )

  // --- logs ---
  mcp.tool(
    'logs',
    'Get or clear project logs. Channels: console, errors, server-console, dev-events, network. Includes build status.',
    {
      project: z.string().optional().describe('Project (server ID, projectId, or directory). Default: current.'),
      action: z.enum(['get', 'clear']).optional().describe('get (default) or clear'),
      channels: z.array(z.string()).optional().describe('Filter to specific channels'),
      since_checkpoint: z.boolean().optional().describe('Only events since last clear'),
      since_ts: z.number().optional().describe('Only events after this Unix ms timestamp'),
      limit: z.number().optional().describe('Max events per channel (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level (error, warn, etc.)'),
      search: z.string().optional().describe('Text search across payloads'),
      browser_id: z.string().optional().describe('Filter by browser ID'),
    },
    async (args) => {
      try {
        const logPaths = getLogPaths(ctx, args.project)

        if (args.action === 'clear') {
          const channelsToClear = args.channels ?? Object.keys(logPaths)
          const countsBefore = truncateChannelFiles(logPaths, channelsToClear)
          ctx.session.checkpointTs = Date.now()
          return jsonResult({
            checkpoint_ts: ctx.session.checkpointTs,
            logs_cleared: countsBefore,
          })
        }

        // Default: get
        const result = getDiagnostics(logPaths, ctx.session, {
          since_checkpoint: args.since_checkpoint,
          since_ts: args.since_ts,
          limit: args.limit,
          level: args.level,
          search: args.search,
          browserId: args.browser_id,
        }, ctx.devEventsWriter)

        return jsonResult(result)
      } catch (err: any) {
        return errResult(err)
      }
    },
  )
}
