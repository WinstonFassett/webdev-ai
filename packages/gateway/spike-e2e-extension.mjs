#!/usr/bin/env node
/**
 * Spike Phase 1.3: End-to-end extension test
 *
 * Tests Playwright through the gateway's CDP relay, with the extension
 * providing CDP access instead of Chrome's --remote-debugging-port.
 *
 * Prerequisites:
 *   1. Gateway running: npx web-dev-mcp (from packages/gateway)
 *   2. Chrome with extension loaded:
 *      - Open chrome://extensions
 *      - Enable Developer mode
 *      - Load unpacked → select packages/extension/
 *      - Open a localhost page (e.g. from a dev server)
 *      - Extension should auto-detect and attach
 *
 * Usage:
 *   node spike-e2e-extension.mjs
 */

import { chromium } from 'playwright-core'

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:3333'

async function main() {
  console.log(`Testing Playwright through gateway relay at ${GATEWAY_URL}...`)

  // First check if the relay has targets
  console.log('\n--- Checking relay status ---')
  try {
    const versionRes = await fetch(`${GATEWAY_URL}/json/version`)
    const version = await versionRes.json()
    console.log(`✓ Relay available: ${version.Browser}`)
    console.log(`  WS URL: ${version.webSocketDebuggerUrl}`)

    const listRes = await fetch(`${GATEWAY_URL}/json/list`)
    const targets = await listRes.json()
    console.log(`✓ Targets: ${targets.length}`)
    for (const t of targets) {
      console.log(`    - ${t.type}: ${t.url}`)
    }

    if (targets.length === 0) {
      console.log('\n⚠ No targets available. Make sure:')
      console.log('  1. The extension is loaded in Chrome')
      console.log('  2. A localhost page is open')
      console.log('  3. The extension detected and attached to it')
      process.exit(1)
    }
  } catch (e) {
    console.error(`✗ Gateway not reachable: ${e.message}`)
    console.error('  Make sure the gateway is running: npx web-dev-mcp')
    process.exit(1)
  }

  // Connect Playwright
  console.log('\n--- Connecting Playwright ---')
  let browser
  try {
    browser = await chromium.connectOverCDP(GATEWAY_URL)
    console.log('✓ Connected via relay')
  } catch (e) {
    console.error(`✗ Failed: ${e.message}`)
    process.exit(1)
  }

  const contexts = browser.contexts()
  console.log(`✓ ${contexts.length} context(s)`)

  const allPages = contexts.flatMap(c => c.pages())
  console.log(`✓ ${allPages.length} page(s)`)
  for (const p of allPages) {
    console.log(`    - ${p.url()}`)
  }

  const page = allPages[0]
  if (!page) {
    console.error('✗ No pages found')
    process.exit(1)
  }

  // Test evaluate
  console.log('\n--- Test: page.evaluate() ---')
  try {
    const title = await page.evaluate(() => document.title)
    console.log(`✓ Title: "${title}"`)
  } catch (e) {
    console.error(`✗ ${e.message}`)
  }

  // Test screenshot
  console.log('\n--- Test: page.screenshot() ---')
  try {
    const buf = await Promise.race([
      page.screenshot({ type: 'png' }),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout 5s')), 5000))
    ])
    console.log(`✓ Screenshot: ${buf.length} bytes`)
    const fs = await import('fs')
    fs.writeFileSync('/tmp/spike-extension-screenshot.png', buf)
    console.log(`✓ Saved to /tmp/spike-extension-screenshot.png`)
  } catch (e) {
    console.log(`⚠ ${e.message}`)
  }

  // Test locator
  console.log('\n--- Test: Locator ---')
  try {
    const loc = page.locator('body')
    const text = await loc.textContent()
    console.log(`✓ Body text: ${text?.slice(0, 100)}...`)
  } catch (e) {
    console.error(`✗ ${e.message}`)
  }

  // Test CDP session
  console.log('\n--- Test: CDP session ---')
  try {
    const cdp = await page.context().newCDPSession(page)
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    console.log(`✓ A11y tree: ${nodes.length} nodes`)
    await cdp.detach()
  } catch (e) {
    console.error(`✗ ${e.message}`)
  }

  console.log('\n=== Extension E2E test complete ===')
  try { await browser.close() } catch {}
}

main().catch(e => {
  console.error('Fatal:', e.message)
  process.exit(1)
})
