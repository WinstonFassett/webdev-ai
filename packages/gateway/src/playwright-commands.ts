/**
 * Playwright command implementations — used when Chrome extension CDP is available.
 * Falls back to injected client RPC commands when extension is not connected.
 *
 * Each function maps an MCP tool command to the equivalent Playwright API call.
 * Based on @xmorse/playwright-core with getExistingCDPSession pattern from Playwriter.
 */

import type { Page } from '@xmorse/playwright-core'
import type { CDPRelay } from './cdp-relay.js'

/**
 * Try to execute a browser command via Playwright.
 * Returns the result if CDP is available, or null to signal fallback to RPC.
 *
 * @param serverPort - dev server port to match against page URLs for multi-tab targeting
 */
export async function tryPlaywrightCommand(
  relay: CDPRelay | undefined,
  method: string,
  params?: any,
  serverPort?: number,
): Promise<any | null> {
  if (!relay) return null

  // Auto-activate debugging on first CDP tool use (passive mode)
  if (!relay.isAvailable) {
    if (!relay.canActivate) return null
    const activated = await relay.ensureDebugging()
    if (!activated) return null
  } else {
    // Reset idle timer on every tool call
    relay.ensureDebugging()
  }

  const page = await relay.getPage(serverPort)
  if (!page) return null

  try {
    switch (method) {
      case 'screenshot':
        return await pwScreenshot(page, params)
      case 'click':
        return await pwClick(page, params, relay)
      case 'fill':
        return await pwFill(page, params, relay)
      case 'hover':
        return await pwHover(page, params, relay)
      case 'selectOption':
        return await pwSelectOption(page, params)
      case 'pressKey':
        return await pwPressKey(page, params)
      case 'scroll':
        return await pwScroll(page, params)
      case 'navigate':
        return await pwNavigate(page, params)
      case 'goBack':
        await page.goBack()
        return { url: page.url() }
      case 'goForward':
        await page.goForward()
        return { url: page.url() }
      case 'queryDom':
        return await pwQueryDom(relay, page, params)
      case 'a11ySnapshot':
        return await pwA11ySnapshot(relay, page, params)
      case 'getVisibleText':
        return await pwGetVisibleText(page, params)
      default:
        // Not a command we handle via Playwright — fall back to RPC
        return null
    }
  } catch (e: any) {
    // If Playwright fails, fall back to RPC rather than erroring
    console.log(`[playwright] ${method} failed, falling back to RPC: ${e.message}`)
    return null
  }
}

// ---- Command implementations ----

async function pwScreenshot(page: Page, params?: any): Promise<any> {
  const opts: any = { type: params?.format === 'png' ? 'png' : 'jpeg' }

  if (params?.format === 'jpeg' || !params?.format) {
    opts.quality = params?.quality ?? 80
  }

  if (params?.selector) {
    const el = page.locator(params.selector).first()
    const buf = await el.screenshot(opts)
    const box = await el.boundingBox()
    return {
      data: `data:image/${opts.type};base64,${buf.toString('base64')}`,
      width: Math.round(box?.width ?? 0),
      height: Math.round(box?.height ?? 0),
    }
  }

  if (params?.preset === 'full') {
    opts.fullPage = true
  }

  const buf = await page.screenshot(opts)
  const viewport = page.viewportSize() || { width: 1280, height: 720 }
  return {
    data: `data:image/${opts.type};base64,${buf.toString('base64')}`,
    width: viewport.width,
    height: params?.preset === 'full' ? undefined : viewport.height,
  }
}

/** Resolve a selector — supports CSS, text=, and ref= prefixes */
async function resolveLocator(page: Page, relay: CDPRelay | null, selector: string) {
  if (selector.startsWith('ref=')) {
    if (!relay) throw new Error('ref= requires CDP extension')
    const locator = await resolveRef(relay, page, selector.slice(4))
    if (locator.error) throw new Error(locator.error)
    return locator
  }
  if (selector.startsWith('text=')) {
    return page.getByText(selector.slice(5)).first()
  }
  return page.locator(selector).first()
}

async function pwClick(page: Page, params?: any, relay?: CDPRelay): Promise<any> {
  const selector = params?.selector
  if (!selector) throw new Error('selector required')
  const locator = await resolveLocator(page, relay || null, selector)
  await locator.click()
  return { clicked: selector }
}

async function pwFill(page: Page, params?: any, relay?: CDPRelay): Promise<any> {
  const { selector, value } = params || {}
  if (!selector || value === undefined) throw new Error('selector and value required')
  const locator = await resolveLocator(page, relay || null, selector)
  await locator.fill(String(value))
  return { filled: selector, value }
}

async function pwHover(page: Page, params?: any, relay?: CDPRelay): Promise<any> {
  const selector = params?.selector
  if (!selector) throw new Error('selector required')
  const locator = await resolveLocator(page, relay || null, selector)
  await locator.hover()
  return { hovered: selector }
}

async function pwSelectOption(page: Page, params?: any): Promise<any> {
  const { selector, value } = params || {}
  await page.locator(selector).first().selectOption(value)
  return { selected: selector, value }
}

async function pwPressKey(page: Page, params?: any): Promise<any> {
  const { key, modifiers } = params || {}
  let keyCombo = key
  if (modifiers) {
    const mods = Array.isArray(modifiers) ? modifiers : [modifiers]
    keyCombo = [...mods, key].join('+')
  }
  await page.keyboard.press(keyCombo)
  return { pressed: keyCombo }
}

async function pwScroll(page: Page, params?: any): Promise<any> {
  if (params?.selector) {
    await page.locator(params.selector).first().scrollIntoViewIfNeeded()
    return { scrolled: params.selector }
  }
  const x = params?.x ?? 0
  const y = params?.y ?? 0
  await page.evaluate(([sx, sy]) => window.scrollTo(sx, sy), [x, y])
  return { scrolled: { x, y } }
}

async function pwNavigate(page: Page, params?: any): Promise<any> {
  await page.goto(params?.url, { waitUntil: 'domcontentloaded', timeout: 15000 })
  return { url: page.url(), title: await page.title() }
}

async function pwQueryDom(relay: CDPRelay, page: Page, params?: any): Promise<any> {
  // Use CDP Accessibility.getFullAXTree for richer DOM inspection
  try {
    const cdp = await relay.getCDPSession(page)
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')

    // Build a simplified a11y tree
    const interactive = nodes.filter((n: any) =>
      n.role?.value && !['none', 'generic', 'InlineTextBox', 'StaticText'].includes(n.role.value)
    )

    const lines: string[] = []
    for (const node of interactive.slice(0, 100)) {
      const role = node.role?.value || ''
      const name = node.name?.value || ''
      const value = node.value?.value || ''
      lines.push(`${role}: ${name}${value ? ` = "${value}"` : ''}`)
    }

    return { html: lines.join('\n'), nodeCount: nodes.length }
  } catch {
    // Fall back to null — will use RPC
    return null
  }
}

// ---- A11y Snapshot with Refs ----

/** Roles that are structural containers — keep for tree context but don't assign refs */
const STRUCTURAL_ROLES = new Set([
  'banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation',
  'region', 'search', 'list', 'listitem', 'table', 'row', 'cell',
  'heading', 'group', 'toolbar', 'tablist', 'tabpanel', 'menu', 'menubar',
  'tree', 'treegrid', 'grid', 'dialog', 'alertdialog', 'article', 'figure',
])

/** Roles that are interactive — assign refs to these */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'switch',
  'slider', 'spinbutton', 'searchbox', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'tab', 'treeitem', 'gridcell', 'scrollbar',
  'progressbar',
])

/** Roles to skip entirely — these are noise */
const SKIP_ROLES = new Set([
  'none', 'presentation', 'generic', 'InlineTextBox', 'StaticText',
  'LineBreak', 'paragraph', 'Section',
])

interface AXTreeNode {
  role: string
  name: string
  value?: string
  children: AXTreeNode[]
  ref?: string
  backendDOMNodeId?: number
  properties?: Record<string, any>
}

/** Cached ref entry for resolving ref-based actions */
export interface RefEntry {
  role: string
  name: string
  backendDOMNodeId?: number
}

/**
 * Build a filtered a11y tree from CDP AX nodes.
 * Assigns ref IDs to interactive elements.
 */
function buildA11yTree(nodes: any[]): { tree: AXTreeNode[], refs: Map<string, RefEntry> } {
  if (!nodes.length) return { tree: [], refs: new Map() }

  // Build lookup: nodeId → AX node
  const nodeMap = new Map<string, any>()
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node)
  }

  let refCounter = 0
  const refs = new Map<string, RefEntry>()

  function processNode(axNode: any): AXTreeNode | null {
    const role = axNode.role?.value || ''
    const name = axNode.name?.value || ''
    const value = axNode.value?.value

    // Skip noise roles
    if (SKIP_ROLES.has(role)) {
      // But process children — they might be meaningful
      const promotedChildren: AXTreeNode[] = []
      for (const childId of axNode.childIds || []) {
        const child = nodeMap.get(childId)
        if (child) {
          const processed = processNode(child)
          if (processed) promotedChildren.push(processed)
        }
      }
      // If skipped node has exactly one child, promote it directly
      if (promotedChildren.length === 1) return promotedChildren[0]
      // If multiple children, skip this level but return children
      if (promotedChildren.length > 1) {
        return { role: '', name: '', children: promotedChildren }
      }
      return null
    }

    // Ignore elements with no name and no children (empty containers)
    const childIds = axNode.childIds || []

    // Process children
    const children: AXTreeNode[] = []
    for (const childId of childIds) {
      const child = nodeMap.get(childId)
      if (child) {
        const processed = processNode(child)
        if (processed) children.push(processed)
      }
    }

    // Skip empty structural nodes with no name
    if (!name && children.length === 0 && !INTERACTIVE_ROLES.has(role)) {
      return null
    }

    const treeNode: AXTreeNode = { role, name, children }
    if (value) treeNode.value = value
    if (axNode.backendDOMNodeId) treeNode.backendDOMNodeId = axNode.backendDOMNodeId

    // Assign ref to interactive elements
    if (INTERACTIVE_ROLES.has(role)) {
      // Check for stable IDs from common test attributes
      const props = axNode.properties || []
      // Build ref: prefer data-testid from description, fall back to sequential
      const ref = `e${refCounter++}`
      treeNode.ref = ref
      refs.set(ref, {
        role,
        name,
        backendDOMNodeId: axNode.backendDOMNodeId,
      })
    }

    return treeNode
  }

  // Start from root (first node)
  const root = processNode(nodes[0])
  const tree = root ? (root.role ? [root] : root.children) : []

  return { tree, refs }
}

/**
 * Render a11y tree as indented text.
 * Interactive elements get [ref=eN] annotations.
 */
function renderA11yTree(nodes: AXTreeNode[], indent: number = 0): string {
  const lines: string[] = []
  const pad = '  '.repeat(indent)

  for (const node of nodes) {
    // Skip wrapper nodes with empty role (promoted from skipped parents)
    if (!node.role && node.children.length > 0) {
      lines.push(renderA11yTree(node.children, indent))
      continue
    }

    let line = `${pad}- ${node.role}`
    if (node.name) line += ` "${node.name}"`
    if (node.value) line += ` = "${node.value}"`
    if (node.ref) line += ` [ref=${node.ref}]`

    lines.push(line)

    if (node.children.length > 0) {
      lines.push(renderA11yTree(node.children, indent + 1))
    }
  }

  return lines.join('\n')
}

/**
 * Take an a11y snapshot with ref IDs for interactive elements.
 * Caches refs on the relay for subsequent ref-based actions.
 */
export async function pwA11ySnapshot(relay: CDPRelay, page: Page, params?: any): Promise<any> {
  try {
    const cdp = await relay.getCDPSession(page)
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')

    const { tree, refs } = buildA11yTree(nodes)
    const snapshot = renderA11yTree(tree)

    // Cache refs on relay for ref-based actions
    relay.refCache = refs

    return {
      snapshot,
      refCount: refs.size,
      nodeCount: nodes.length,
    }
  } catch (e: any) {
    return { error: `a11y snapshot failed: ${e.message}` }
  }
}

/**
 * Resolve a ref (e.g. "e3") to a Playwright locator action.
 * Uses cached refs from the last a11y_snapshot call.
 */
export async function resolveRef(relay: CDPRelay, page: Page, ref: string): Promise<any> {
  const entry = relay.refCache?.get(ref)
  if (!entry) {
    return { error: `Unknown ref "${ref}". Call a11y_snapshot first to assign refs.` }
  }

  // Resolve via role + name (most reliable Playwright locator)
  const { role, name } = entry
  return page.getByRole(role as any, name ? { name } : undefined).first()
}

async function pwGetVisibleText(page: Page, params?: any): Promise<any> {
  const selector = params?.selector || 'body'
  const text = await page.locator(selector).first().innerText()
  return { text }
}
