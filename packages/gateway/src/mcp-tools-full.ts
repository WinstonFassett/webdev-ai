// Full MCP tool set: all legacy tools for MCP-only agents (Cursor, Windsurf, etc.)
// These are registered in addition to core tools when ?tools=full is set.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import { getLogPaths } from './mcp-tools-core.js'
import { queryLogs } from './log-reader.js'

import { cmd, errResult } from './mcp-tools-core.js'

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
