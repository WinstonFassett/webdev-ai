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
        return await pwClick(page, params)
      case 'fill':
        return await pwFill(page, params)
      case 'hover':
        return await pwHover(page, params)
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

async function pwClick(page: Page, params?: any): Promise<any> {
  const selector = params?.selector
  if (!selector) throw new Error('selector required')

  if (selector.startsWith('text=')) {
    await page.getByText(selector.slice(5)).first().click()
  } else {
    await page.locator(selector).first().click()
  }
  return { clicked: selector }
}

async function pwFill(page: Page, params?: any): Promise<any> {
  const { selector, value } = params || {}
  if (!selector || value === undefined) throw new Error('selector and value required')
  await page.locator(selector).first().fill(String(value))
  return { filled: selector, value }
}

async function pwHover(page: Page, params?: any): Promise<any> {
  await page.locator(params?.selector).first().hover()
  return { hovered: params?.selector }
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

async function pwGetVisibleText(page: Page, params?: any): Promise<any> {
  const selector = params?.selector || 'body'
  const text = await page.locator(selector).first().innerText()
  return { text }
}
