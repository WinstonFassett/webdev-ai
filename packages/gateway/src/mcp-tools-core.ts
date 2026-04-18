// Core MCP tools: set_project, list_projects, list_browsers, get_diagnostics, clear, eval_js,
// query_dom, screenshot, a11y_snapshot

import { z } from 'zod'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import type { RegisteredServer } from './registry.js'
import { truncateChannelFiles } from './session.js'
import { getDiagnostics } from './log-reader.js'
import { browserCommand, getAllBrowsers } from './rpc-server.js'
import { tryPlaywrightCommand } from './playwright-commands.js'

// --- Project Resolution ---

const GATEWAY_PROJECT = '__gateway'

export interface ResolvedProject {
  type: 'project' | 'gateway'
  server?: RegisteredServer
  logPaths: Record<string, string>
  serverId?: string
}

/**
 * Resolve project from an explicit arg, session currentProject, or auto (single project).
 *
 * Accepts: full directory path, projectId (basename-hash4), or "__gateway".
 * Throws on ambiguity or missing context.
 */
export function resolveProject(ctx: McpContext, projectArg?: string): ResolvedProject {
  const target = projectArg ?? ctx.currentProject
  const registry = ctx.registry

  // __gateway virtual project
  if (target === GATEWAY_PROJECT) {
    return { type: 'gateway', logPaths: ctx.session.files }
  }

  if (target && registry) {
    // Try exact directory match
    let server = registry.getByDirectory(target)
    if (server) return { type: 'project', server, logPaths: server.logPaths, serverId: server.id }

    // Try projectId match (basename-hash4)
    server = registry.getByProjectId(target)
    if (server) return { type: 'project', server, logPaths: server.logPaths, serverId: server.id }

    // Try parent/child match: target is parent of registered dir, or vice versa
    for (const s of registry.getAll()) {
      if (s.directory.startsWith(target + '/') || target.startsWith(s.directory + '/')) {
        return { type: 'project', server: s, logPaths: s.logPaths, serverId: s.id }
      }
    }

    throw new Error(`No project found matching "${target}". Use list_projects to see available projects.`)
  }

  // No explicit target — try auto-resolve
  if (registry) {
    const size = registry.size()
    if (size === 1) {
      const server = registry.getAll()[0]
      return { type: 'project', server, logPaths: server.logPaths, serverId: server.id }
    }
    if (size > 1) {
      const projects = registry.getAll().map(s => `  ${s.projectId} (${s.directory})`).join('\n')
      throw new Error(`Multiple projects registered. Call set_project first:\n${projects}`)
    }
  }

  // No registry or no servers — fall back to gateway
  return { type: 'gateway', logPaths: ctx.session.files }
}

/** Convenience: resolve and get log paths */
export function getLogPaths(ctx: McpContext, projectArg?: string): Record<string, string> {
  return resolveProject(ctx, projectArg).logPaths
}

/** Convenience: resolve and get server ID for browser lookup */
export function getServerId(ctx: McpContext, projectArg?: string): string | undefined {
  return resolveProject(ctx, projectArg).serverId
}

// --- Tool Registration ---

export function errResult(err: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
}

/** Send a command to the browser. Tries Playwright (CDP) first, falls back to injected client RPC. */
export async function cmd(ctx: McpContext, method: string, params?: any) {
  const resolved = (() => { try { return resolveProject(ctx) } catch { return null } })()
  const serverPort = resolved?.server?.port
  const pwResult = await tryPlaywrightCommand(ctx.cdpRelay, method, params, serverPort)
  if (pwResult !== null) return pwResult

  const serverId = (() => { try { return resolveProject(ctx).serverId } catch { return undefined } })()
  return browserCommand(serverId, method, params)
}

export function registerCoreTools(mcp: McpServer, ctx: McpContext) {

  // --- set_project ---
  mcp.tool(
    'set_project',
    'Set the current project for this session. Required before using browser tools when multiple projects are registered. Accepts: project short ID (from list_projects), full directory path, or "__gateway" for gateway-level operations.',
    {
      project: z.string().describe('Project identifier: short ID (e.g. "nextjs-turbopack-a3f7"), full directory path, or "__gateway"'),
    },
    async (args) => {
      const target = args.project

      if (target === GATEWAY_PROJECT) {
        ctx.currentProject = GATEWAY_PROJECT
        return { content: [{ type: 'text' as const, text: JSON.stringify({ project: GATEWAY_PROJECT, type: 'web-dev-mcp-gateway' }) }] }
      }

      // Validate it resolves before setting
      const resolved = resolveProject(ctx, target)
      if (resolved.type === 'project' && resolved.server) {
        ctx.currentProject = resolved.server.directory
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            project: resolved.server.projectId,
            directory: resolved.server.directory,
            type: resolved.server.type,
            serverId: resolved.server.id,
          }) }],
        }
      }

      // Shouldn't reach here but handle gracefully
      ctx.currentProject = target
      return { content: [{ type: 'text' as const, text: JSON.stringify({ project: target, status: 'set' }) }] }
    },
  )

  // --- list_projects ---
  mcp.tool(
    'list_projects',
    'List all registered dev server projects and the __gateway virtual project.',
    {},
    async () => {
      const projects: any[] = []

      if (ctx.registry) {
        const browsers = getAllBrowsers()
        for (const server of ctx.registry.getAll()) {
          const browserCount = browsers.filter(b => b.serverId === server.id).length
          projects.push({
            id: server.projectId,
            directory: server.directory,
            type: server.type,
            port: server.port,
            serverId: server.id,
            browsers: browserCount,
            current: ctx.currentProject === server.directory,
          })
        }
      }

      projects.push({
        id: GATEWAY_PROJECT,
        type: 'web-dev-mcp-gateway',
        current: ctx.currentProject === GATEWAY_PROJECT,
      })

      return { content: [{ type: 'text' as const, text: JSON.stringify(projects, null, 2) }] }
    },
  )

  // --- list_browsers ---
  mcp.tool(
    'list_browsers',
    'List all connected browsers with their project association.',
    {},
    async () => {
      const browsers = getAllBrowsers()
      const result = browsers.map(b => {
        const server = b.serverId && ctx.registry ? ctx.registry.get(b.serverId) : undefined
        return {
          id: b.browserId,
          connId: b.connId,
          project: server?.projectId ?? null,
          directory: server?.directory ?? null,
          serverId: b.serverId,
          connectedAt: b.connectedAt,
        }
      })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  // --- get_diagnostics ---
  mcp.tool(
    'get_diagnostics',
    'Consolidated diagnostic snapshot: browser logs + server logs + build status + summary.',
    {
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
      since_checkpoint: z.boolean().optional().describe('Use checkpoint from last clear'),
      since_ts: z.number().optional().describe('Unix ms timestamp'),
      limit: z.number().optional().describe('Max events per channel (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level (e.g. "error", "warn")'),
      search: z.string().optional().describe('Text search across event payload (case-insensitive)'),
      browser_id: z.string().optional().describe('Filter by browser ID'),
    },
    async (args) => {
      try {
        const logPaths = getLogPaths(ctx, args.project)
        const result = getDiagnostics(logPaths, ctx.session, {
          since_checkpoint: args.since_checkpoint,
          since_ts: args.since_ts,
          limit: args.limit,
          level: args.level,
          search: args.search,
          browserId: args.browser_id,
        }, ctx.devEventsWriter)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true }
      }
    },
  )

  // --- clear ---
  mcp.tool(
    'clear',
    'Truncate log files and set checkpoint. Call before a code change so get_diagnostics(since_checkpoint) shows only new events.',
    {
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
      channels: z.array(z.string()).optional().describe('Which log channels to clear. Default: all.'),
    },
    async (args) => {
      try {
        const resolved = resolveProject(ctx, args.project)
        let channelsToClear = args.channels
        if (!channelsToClear || channelsToClear.length === 0) {
          channelsToClear = Object.keys(resolved.logPaths)
        }
        const countsBefore = truncateChannelFiles(resolved.logPaths, channelsToClear)
        ctx.session.checkpointTs = Date.now()

        // Clear browser console for connected browsers
        let browsersCleared = 0
        if (resolved.serverId) {
          const connected = getAllBrowsers().filter(b => b.serverId === resolved.serverId)
          if (connected.length > 0) {
            await browserCommand(resolved.serverId, 'eval', { code: 'console.clear()' }).catch(() => {})
            browsersCleared = connected.length
          }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            checkpoint_ts: ctx.session.checkpointTs,
            logs_cleared: countsBefore,
            browsers_cleared: browsersCleared,
          }, null, 2) }],
        }
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true }
      }
    },
  )

  // --- eval_js ---
  mcp.tool(
    'eval_js',
    'Run JavaScript in the browser with full DOM access. Multi-statement, supports await. Persistent `state` object survives across calls. `browser.*` helpers for common operations.',
    {
      code: z.union([z.string(), z.array(z.string())]).describe('JavaScript code to run in browser. String for single eval, array of strings for auto-waited pipeline (DOM settles between steps). Promises are auto-awaited. Globals: `document`, `window`, `localStorage`, `sessionStorage` (real browser objects), `state` (persists across calls), `browser` (helpers: .markdown(sel?), .screenshot(sel?), .navigate(url), .click(sel), .fill(sel, val), .waitFor(selectorOrFn, interval?, timeout?), .eval(expr), .elementSource(sel)).'),
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
    },
    async (args) => {
      try {
        const resolved = resolveProject(ctx, args.project)
        if (resolved.type === 'gateway') {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: '__gateway has no browser. Use set_project to target a real project.' }) }], isError: true }
        }

        const start = Date.now()
        let result = await browserCommand(resolved.serverId, 'eval', { code: args.code })

        // Intercept screenshot results from browser.screenshot() — save to file instead of
        // dumping base64 into the agent context
        let parsed = result
        if (typeof result === 'string' && result.includes('data:image/')) {
          try { parsed = JSON.parse(result) } catch {}
        }
        if (parsed && typeof parsed === 'object' && typeof (parsed as any).data === 'string'
            && (parsed as any).data.startsWith('data:image/')) {
          const data = (parsed as any).data as string
          const mimeType = data.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
          const base64 = data.replace(/^data:image\/\w+;base64,/, '')
          const logDir = resolved.server?.logDir ?? ctx.session.logDir
          const screenshotDir = join(logDir, 'screenshots')
          mkdirSync(screenshotDir, { recursive: true })
          const ext = mimeType === 'image/png' ? 'png' : 'jpeg'
          const filename = `screenshot-${Date.now()}.${ext}`
          const filePath = join(screenshotDir, filename)
          writeFileSync(filePath, Buffer.from(base64, 'base64'))
          result = { path: filePath, width: (parsed as any).width, height: (parsed as any).height }
        }

        const serialized = typeof result === 'string' ? result
          : result === undefined ? 'undefined'
          : result === null ? 'null'
          : JSON.stringify(result, null, 2)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ result: serialized, duration_ms: Date.now() - start }, null, 2) }],
        }
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }],
          isError: true,
        }
      }
    },
  )

  // --- query_dom ---
  mcp.tool(
    'query_dom',
    'Inspect DOM structure. Returns simplified tree with tags, key attributes, and text. For page content/text, use get_page_markdown instead. Start specific (#main, .hero-section, [role="navigation"]). Use "body" with max_depth:3 only for a page skeleton overview. If output exceeds max_output, behavior depends on on_limit: "hint" (default) stops and returns child hints to narrow your selector; "file" writes the full result to a file you can read/grep.',
    {
      selector: z.string().optional().describe('CSS selector (default: body)'),
      max_depth: z.number().optional().describe('Max nesting depth (default: 3)'),
      max_output: z.number().optional().describe('Max output chars before limit behavior kicks in (default: 30000, max: 200000)'),
      on_limit: z.enum(['hint', 'file']).optional().describe('What to do when output exceeds max_output. "hint" (default): stop and return child selector hints. "file": write full result to a file and return the path.'),
      include_source: z.boolean().optional().describe('Include source file:line and component name on elements (React, Vue, Svelte, Preact dev mode). Default: false.'),
      attributes: z.array(z.string()).optional().describe('Attributes to include'),
      text_length: z.number().optional().describe('Max text chars per element (default: 100)'),
      visible_only: z.boolean().optional().describe('Exclude hidden elements (display:none, visibility:hidden, opacity:0, aria-hidden, zero-size). Default: true. Set false to include all elements.'),
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
    },
    async (args) => {
      try {
        const result = await cmd(ctx, 'queryDom', {
          selector: args.selector ?? 'body',
          max_depth: args.max_depth,
          max_output: args.max_output,
          on_limit: args.on_limit,
          include_source: args.include_source,
          attributes: args.attributes,
          text_length: args.text_length,
          visible_only: args.visible_only,
        })
        const r = result as any

        if (r.too_large) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                too_large: true,
                element_count: r.element_count,
                child_count: r.child_count,
                children_hints: r.children_hints,
                hint: r.hint,
                partial_html: r.html || undefined,
              }, null, 2),
            }],
          }
        }

        if (r.write_to_file) {
          const fullHtml = r.html ?? ''
          const resolved = resolveProject(ctx)
          const logDir = resolved.server?.logDir ?? ctx.session.logDir
          const domDir = join(logDir, 'dom-snapshots')
          mkdirSync(domDir, { recursive: true })
          const filename = `query-dom-${Date.now()}.html`
          const filePath = join(domDir, filename)
          writeFileSync(filePath, fullHtml)

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                file: filePath,
                file_lines: fullHtml.split('\n').length,
                file_chars: fullHtml.length,
                element_count: r.element_count,
                child_count: r.child_count,
                children_hints: r.children_hints,
                hint: `Full DOM snapshot written to file (${fullHtml.split('\n').length} lines, ${fullHtml.length} chars). Read or grep it.`,
              }, null, 2),
            }],
          }
        }

        return { content: [{ type: 'text' as const, text: r.html ?? JSON.stringify(r, null, 2) }] }
      } catch (err: any) { return errResult(err) }
    },
  )

  // --- screenshot ---
  mcp.tool(
    'screenshot',
    'Take a screenshot. Saves to .web-dev-mcp/screenshots/ and returns file path (use inline:true for base64). Presets: viewport (default), element, full, thumb, hd.',
    {
      selector: z.string().optional().describe('CSS selector. Omit for viewport.'),
      preset: z.enum(['viewport', 'element', 'full', 'thumb', 'hd']).optional().describe('Screenshot preset. Default: viewport (or element if selector given).'),
      format: z.enum(['png', 'jpeg']).optional().describe('Image format. Default: jpeg.'),
      quality: z.number().optional().describe('JPEG quality 1-100. Default: 80.'),
      label: z.string().optional().describe('Label for the filename (e.g. "login-page"). Slugified.'),
      inline: z.boolean().optional().describe('Return base64 image data instead of saving to file. Default: false.'),
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
    },
    async (args) => {
      try {
        const opts: any = {}
        if (args.selector) opts.selector = args.selector
        if (args.preset) opts.preset = args.preset
        if (args.format) opts.format = args.format
        if (args.quality) opts.quality = args.quality
        const result = await cmd(ctx, 'screenshot', Object.keys(opts).length > 0 ? opts : undefined)
        if ((result as any).error) return errResult(result)
        const data = (result as any).data
        const mimeType = data.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
        const base64 = data.replace(/^data:image\/\w+;base64,/, '')
        const { width, height } = result as any

        if (args.inline) {
          return {
            content: [
              { type: 'image' as const, data: base64, mimeType },
              { type: 'text' as const, text: JSON.stringify({ width, height }, null, 2) },
            ],
          }
        }

        const resolved = resolveProject(ctx)
        const logDir = resolved.server?.logDir ?? ctx.session.logDir
        const screenshotDir = join(logDir, 'screenshots')
        mkdirSync(screenshotDir, { recursive: true })

        const ext = mimeType === 'image/png' ? 'png' : 'jpeg'
        const timestamp = Date.now()
        const slug = args.label ? '-' + args.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : ''
        const filename = `screenshot-${timestamp}${slug}.${ext}`
        const filePath = join(screenshotDir, filename)

        writeFileSync(filePath, Buffer.from(base64, 'base64'))

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ path: filePath, width, height }, null, 2) },
          ],
        }
      } catch (err: any) { return errResult(err) }
    },
  )

  // --- a11y_snapshot ---
  mcp.tool(
    'a11y_snapshot',
    'Returns an accessibility tree snapshot with ref IDs on interactive elements. Use refs with click/fill/hover (e.g. selector: "ref=e3") instead of constructing CSS selectors. Requires Chrome extension CDP connection.',
    {
      project: z.string().optional().describe('Project short ID or directory (overrides session default)'),
    },
    async () => {
      try {
        const result = await cmd(ctx, 'a11ySnapshot')
        if (!result) {
          return { content: [{ type: 'text' as const, text: 'a11y_snapshot requires the Chrome extension for CDP access. Install the web-dev-mcp extension and reload the page.' }] }
        }
        const r = result as any
        if (r.error) return errResult(r)
        return {
          content: [{
            type: 'text' as const,
            text: r.snapshot + `\n\n${r.refCount} interactive elements (use ref=eN with click/fill/hover)`,
          }],
        }
      } catch (err: any) { return errResult(err) }
    },
  )
}
