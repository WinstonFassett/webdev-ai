// Full MCP tool set: all legacy tools for MCP-only agents (Cursor, Windsurf, etc.)
// These are registered in addition to core tools when ?tools=full is set.

import { z } from 'zod'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import { getLogPaths, resolveProject } from './mcp-tools-core.js'
import { truncateChannelFiles } from './session.js'
import { queryLogs } from './log-reader.js'
import { browserCommand } from './rpc-server.js'
import { tryPlaywrightCommand } from './playwright-commands.js'

function getServerId(ctx: McpContext): string | undefined {
  try {
    const resolved = resolveProject(ctx)
    if (resolved.type === 'gateway') return undefined
    return resolved.serverId
  } catch {
    return undefined
  }
}

function errResult(err: any) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? String(err) }) }], isError: true }
}

/** Send a command to the browser. Tries Playwright (CDP) first, falls back to injected client RPC. */
async function cmd(ctx: McpContext, method: string, params?: any) {
  // Try Playwright via extension CDP relay first, matched to the current project's port
  const resolved = (() => { try { return resolveProject(ctx) } catch { return null } })()
  const serverPort = resolved?.server?.port
  const pwResult = await tryPlaywrightCommand(ctx.cdpRelay, method, params, serverPort)
  if (pwResult !== null) return pwResult

  // Fall back to injected client RPC
  const serverId = getServerId(ctx)
  return browserCommand(serverId, method, params)
}

export function registerFullTools(mcp: McpServer, ctx: McpContext) {

  mcp.tool(
    'get_session_info',
    'Returns log directory, file paths, and server URLs.',
    async () => {
      const { info } = ctx.session
      const result: any = {
        session_id: info.sessionId,
        log_dir: info.logDir,
        files: info.files,
        channels_active: info.channels,
        server_url: info.serverUrl,
        mcp_url: info.mcpUrl,
        started_at: info.startedAt,
        connected_clients: ctx.connectedClients,
      }
      if (ctx.registry) {
        const servers = ctx.registry.getAll()
        result.mode = servers.length > 0 ? 'hybrid' : 'proxy'
        if (servers.length > 0) result.registered_servers = servers
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

  mcp.tool(
    'clear_logs',
    'Truncates channel log files. Call before a fix iteration so subsequent reads only show new events.',
    { channels: z.array(z.string()).optional().describe("Channels to clear. Default: all.") },
    async (args) => {
      const logPaths = getLogPaths(ctx)
      let channelsToClear = args.channels
      if (!channelsToClear || channelsToClear.length === 0 || channelsToClear.includes('all')) {
        channelsToClear = Object.keys(logPaths)
      }
      const countsBefore = truncateChannelFiles(logPaths, channelsToClear)
      ctx.session.checkpointTs = Date.now()
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          cleared_at: ctx.session.checkpointTs,
          checkpoint_ts: ctx.session.checkpointTs,
          counts_cleared: countsBefore,
        }, null, 2) }],
      }
    },
  )

  mcp.tool(
    'get_build_status',
    'Returns build/HMR update and error counts. Lightweight poll.',
    { since: z.number().optional().describe('Unix ms timestamp, default: session start') },
    async (args) => {
      const status = ctx.devEventsWriter
        ? ctx.devEventsWriter.getStatus(args.since)
        : { last_update_at: null, last_error_at: null, last_error: undefined, update_count: 0, error_count: 0, pending: false }
      return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] }
    },
  )

  mcp.tool(
    'wait_for_condition',
    'Poll browser condition until true or timeout.',
    {
      check: z.string().describe('JS expression (must return truthy)'),
      timeout: z.number().optional().describe('Timeout ms (default: 5000)'),
      interval: z.number().optional().describe('Poll interval ms (default: 100)'),
    },
    async (args) => {
      const timeout = args.timeout ?? 5000
      const interval = args.interval ?? 100
      const startTs = Date.now()
      while (true) {
        const elapsed = Date.now() - startTs
        if (elapsed >= timeout) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ matched: false, duration_ms: elapsed, error: 'Timeout' }, null, 2) }] }
        }
        try {
          const result = await cmd(ctx, 'eval', { code: `return (${args.check})` })
          if (result && result !== 'undefined' && result !== 'null' && result !== 'false') {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ matched: true, duration_ms: Date.now() - startTs }, null, 2) }] }
          }
        } catch {
          // Browser not connected yet, keep polling
        }
        await new Promise(r => setTimeout(r, interval))
      }
    },
  )

  mcp.tool(
    'eval_in_browser',
    'Run JavaScript directly in the browser. Access to all browser globals, framework state, closures.',
    {
      expression: z.string().describe('JavaScript expression to evaluate.'),
      timeout: z.number().optional().describe('Timeout in ms (default: 5000)'),
    },
    async (args) => {
      try {
        const start = Date.now()
        const result = await cmd(ctx, 'eval', { code: `return (${args.expression})` })
        return { content: [{ type: 'text' as const, text: JSON.stringify({ result, duration_ms: Date.now() - start }, null, 2) }] }
      } catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool(
    'get_logs',
    'Query log files with filtering and pagination.',
    {
      channel: z.string().describe('Channel: console, errors, network, dev-events'),
      since_id: z.number().optional().describe('Return events after this ID.'),
      limit: z.number().optional().describe('Max events (default: 50, max: 200)'),
      level: z.string().optional().describe('Filter by level'),
      search: z.string().optional().describe('Text search (case-insensitive)'),
    },
    async (args) => {
      const logPaths = getLogPaths(ctx)
      const result = queryLogs(logPaths, { channel: args.channel, sinceId: args.since_id, limit: args.limit, level: args.level, search: args.search })
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    },
  )

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

        // on_limit: 'hint' — output was truncated, return hint with partial result
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

        // on_limit: 'file' — browser sent full result, write to file
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

  mcp.tool(
    'a11y_snapshot',
    'Returns an accessibility tree snapshot with ref IDs on interactive elements. Use refs with click/fill/hover (e.g. selector: "ref=e3") instead of constructing CSS selectors. Requires Chrome extension CDP connection.',
    {},
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

        // Inline mode: return base64 image data directly (original behavior)
        if (args.inline) {
          return {
            content: [
              { type: 'image' as const, data: base64, mimeType },
              { type: 'text' as const, text: JSON.stringify({ width, height }, null, 2) },
            ],
          }
        }

        // File mode (default): save to .web-dev-mcp/screenshots/
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

  mcp.tool('click', 'Click an element. Supports CSS selector or text= prefix.',
    { selector: z.string().describe('CSS selector or text=...') },
    async (args) => {
      try { const r = await cmd(ctx, 'click', { selector: args.selector }); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('fill', 'Fill an input/textarea. Dispatches input and change events.',
    { selector: z.string().describe('CSS selector or text=...'), value: z.string().describe('Value to fill') },
    async (args) => {
      try { const r = await cmd(ctx, 'fill', { selector: args.selector, value: args.value }); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('select_option', 'Select an option in a <select> element.',
    { selector: z.string().describe('CSS selector'), value: z.string().describe('Option value or text') },
    async (args) => {
      try { const r = await cmd(ctx, 'selectOption', { selector: args.selector, value: args.value }); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('hover', 'Hover over an element.',
    { selector: z.string().describe('CSS selector or text=...') },
    async (args) => {
      try { const r = await cmd(ctx, 'hover', { selector: args.selector }); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('press_key', 'Press a keyboard key, optionally with modifiers.',
    {
      key: z.string().describe('Key (e.g. "Enter", "Escape", "a")'),
      modifiers: z.object({ ctrl: z.boolean().optional(), shift: z.boolean().optional(), alt: z.boolean().optional(), meta: z.boolean().optional() }).optional(),
      selector: z.string().optional().describe('Target element. Default: active element.'),
    },
    async (args) => {
      try { const r = await cmd(ctx, 'pressKey', { key: args.key, modifiers: args.modifiers, selector: args.selector }); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('navigate', 'Navigate the browser to a URL. Disconnects — wait before next call.',
    { url: z.string().describe('URL to navigate to') },
    async (args) => {
      try { const r = await cmd(ctx, 'navigate', { url: args.url }); return { content: [{ type: 'text' as const, text: JSON.stringify(r) }] } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('go_back', 'Navigate back in browser history.',
    async () => {
      try { await cmd(ctx, 'eval', { code: 'history.back()' }); return { content: [{ type: 'text' as const, text: JSON.stringify({ action: 'back' }) }] } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('go_forward', 'Navigate forward in browser history.',
    async () => {
      try { await cmd(ctx, 'eval', { code: 'history.forward()' }); return { content: [{ type: 'text' as const, text: JSON.stringify({ action: 'forward' }) }] } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('scroll', 'Scroll to an element or coordinates.',
    { selector: z.string().optional(), x: z.number().optional(), y: z.number().optional() },
    async (args) => {
      try { const r = await cmd(ctx, 'scroll', { selector: args.selector, x: args.x, y: args.y }); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('get_visible_text', 'Get the visible text content of an element or the whole page.',
    { selector: z.string().optional().describe('CSS selector. Default: body.') },
    async (args) => {
      try { const r = await cmd(ctx, 'getVisibleText', { selector: args.selector }); return { content: [{ type: 'text' as const, text: JSON.stringify(r, null, 2) }], isError: !!(r as any).error } }
      catch (err: any) { return errResult(err) }
    },
  )

  mcp.tool('get_page_markdown', 'Convert page DOM to markdown with links, headings, form elements.',
    { selector: z.string().optional().describe('CSS selector. Default: body.') },
    async (args) => {
      try {
        const r = await cmd(ctx, 'getPageMarkdown', { selector: args.selector })
        if ((r as any).error) return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], isError: true }
        return { content: [{ type: 'text' as const, text: (r as any).markdown }] }
      } catch (err: any) { return errResult(err) }
    },
  )

}
