/**
 * Element context resolution using inline multi-framework source resolver.
 * Handles React, Vue, Svelte, Preact — component names + source locations.
 * No external dependencies (replaces element-source/bippy).
 */
import { createElementSelector } from './utils/css-selector.js'
import { PREVIEW_TEXT_MAX_LENGTH, PREVIEW_ATTR_VALUE_MAX_LENGTH } from './constants.js'
import { resolveElementSource, formatSource } from '../source-resolver.js'

// --- Truncate helper ---
const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '…' : s

// --- Get component display name (sync) ---
export const getComponentDisplayName = (element: Element): string | null => {
  const info = resolveElementSource(element)
  return info?.component ?? null
}

// --- Get HTML preview (compact) ---
export const getHTMLPreview = (element: Element): string => {
  const tag = element.tagName.toLowerCase()
  const text = element instanceof HTMLElement
    ? (element.innerText?.trim() ?? element.textContent?.trim() ?? '')
    : (element.textContent?.trim() ?? '')

  let attrs = ''
  for (const { name, value } of element.attributes) {
    attrs += ` ${name}="${truncate(value, PREVIEW_ATTR_VALUE_MAX_LENGTH)}"`
  }

  const truncatedText = truncate(text, PREVIEW_TEXT_MAX_LENGTH)
  if (truncatedText.length > 0) {
    return `<${tag}${attrs}>\n  ${truncatedText}\n</${tag}>`
  }
  return `<${tag}${attrs} />`
}

// --- Build full element context ---
export interface ElementContext {
  html: string
  stack: string
  component: string | null
  selector: string
  source?: { file: string; line?: number; column?: number }
}

export const getElementContext = async (element: Element): Promise<ElementContext> => {
  const html = getHTMLPreview(element)
  const selector = createElementSelector(element)

  const info = resolveElementSource(element)
  const component = info?.component ?? null
  const src = info ? formatSource(info) : null
  const source: ElementContext['source'] | undefined = info?.file
    ? { file: info.file, line: info.line ?? undefined, column: info.column ?? undefined }
    : undefined

  // Stack is now just a single-line source reference (no full owner chain)
  const stack = src ? `src: ${src}` : ''

  return { html, stack, component, selector, source }
}

// --- Format context as compact card ---
export const formatContextCard = (ctx: ElementContext): string => {
  const lines: string[] = []

  // Header: <ComponentName> (tag) or just <tag>
  if (ctx.component) {
    lines.push(`<${ctx.component}> (${ctx.html.match(/^<(\w+)/)?.[1] ?? '?'})`)
  } else {
    lines.push(ctx.html.split('\n')[0])
  }

  // Source file
  if (ctx.source?.file) {
    let loc = ctx.source.file
    if (ctx.source.line) loc += `:${ctx.source.line}`
    if (ctx.source.column) loc += `:${ctx.source.column}`
    lines.push(`src: ${loc}`)
  }

  // Selector
  lines.push(`sel: ${ctx.selector}`)

  // Live ref hint
  lines.push(`Live ref: window.__LAST_GRABBED__.element`)

  return lines.join('\n')
}
