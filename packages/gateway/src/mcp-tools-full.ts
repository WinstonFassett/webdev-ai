// Full MCP tool set: browser interaction tools for MCP-only agents (Cursor, Windsurf, etc.)
// Registered in addition to core tools when ?tools=full is set.

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpContext } from './mcp-server.js'
import { cmd, errResult, jsonResult } from './mcp-tools-core.js'

export function registerFullTools(mcp: McpServer, ctx: McpContext) {

  // --- browser_click ---
  mcp.tool('browser_click', 'Click an element. Supports CSS selector, text= prefix, or ref= from a11y snapshot.',
    { selector: z.string().describe('CSS selector, text=..., or ref=eN') },
    async (args) => {
      try { return jsonResult(await cmd(ctx, 'click', { selector: args.selector })) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_fill ---
  mcp.tool('browser_fill', 'Fill an input/textarea. Dispatches input and change events.',
    { selector: z.string().describe('CSS selector, text=..., or ref=eN'), value: z.string().describe('Value to fill') },
    async (args) => {
      try { return jsonResult(await cmd(ctx, 'fill', { selector: args.selector, value: args.value })) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_select ---
  mcp.tool('browser_select', 'Select an option in a <select> element.',
    { selector: z.string().describe('CSS selector'), value: z.string().describe('Option value or text') },
    async (args) => {
      try { return jsonResult(await cmd(ctx, 'selectOption', { selector: args.selector, value: args.value })) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_hover ---
  mcp.tool('browser_hover', 'Hover over an element.',
    { selector: z.string().describe('CSS selector, text=..., or ref=eN') },
    async (args) => {
      try { return jsonResult(await cmd(ctx, 'hover', { selector: args.selector })) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_key ---
  mcp.tool('browser_key', 'Press a keyboard key, optionally with modifiers.',
    {
      key: z.string().describe('Key (e.g. "Enter", "Escape", "a")'),
      modifiers: z.object({ ctrl: z.boolean().optional(), shift: z.boolean().optional(), alt: z.boolean().optional(), meta: z.boolean().optional() }).optional(),
      selector: z.string().optional().describe('Target element. Default: active element.'),
    },
    async (args) => {
      try { return jsonResult(await cmd(ctx, 'pressKey', { key: args.key, modifiers: args.modifiers, selector: args.selector })) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_navigate ---
  mcp.tool('browser_navigate', 'Navigate the browser to a URL. Browser may disconnect briefly — wait before next call.',
    { url: z.string().describe('URL to navigate to') },
    async (args) => {
      try { return jsonResult(await cmd(ctx, 'navigate', { url: args.url })) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_back ---
  mcp.tool('browser_back', 'Navigate back in browser history.',
    async () => {
      try { await cmd(ctx, 'eval', { code: 'history.back()' }); return jsonResult({ action: 'back' }) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_forward ---
  mcp.tool('browser_forward', 'Navigate forward in browser history.',
    async () => {
      try { await cmd(ctx, 'eval', { code: 'history.forward()' }); return jsonResult({ action: 'forward' }) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_scroll ---
  mcp.tool('browser_scroll', 'Scroll to an element or coordinates.',
    { selector: z.string().optional(), x: z.number().optional(), y: z.number().optional() },
    async (args) => {
      try { return jsonResult(await cmd(ctx, 'scroll', { selector: args.selector, x: args.x, y: args.y })) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_text ---
  mcp.tool('browser_text', 'Get visible text content of an element or the whole page.',
    { selector: z.string().optional().describe('CSS selector. Default: body.') },
    async (args) => {
      try { return jsonResult(await cmd(ctx, 'getVisibleText', { selector: args.selector })) }
      catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_markdown ---
  mcp.tool('browser_markdown', 'Convert page DOM to markdown with links, headings, form elements.',
    { selector: z.string().optional().describe('CSS selector. Default: body.') },
    async (args) => {
      try {
        const r = await cmd(ctx, 'getPageMarkdown', { selector: args.selector })
        if ((r as any).error) return errResult(new Error((r as any).error))
        return { content: [{ type: 'text' as const, text: (r as any).markdown }] }
      } catch (err: any) { return errResult(err) }
    },
  )

  // --- browser_wait ---
  mcp.tool('browser_wait', 'Poll browser condition until true or timeout.',
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
          return jsonResult({ matched: false, duration_ms: elapsed, error: 'Timeout' })
        }
        try {
          const result = await cmd(ctx, 'eval', { code: `return (${args.check})` })
          if (result && result !== 'undefined' && result !== 'null' && result !== 'false') {
            return jsonResult({ matched: true, duration_ms: Date.now() - startTs })
          }
        } catch {
          // Browser not connected yet, keep polling
        }
        await new Promise(r => setTimeout(r, interval))
      }
    },
  )
}
