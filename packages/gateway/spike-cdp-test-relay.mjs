#!/usr/bin/env node
/**
 * Spike Phase 0.2: Test Playwright through CDP relay
 *
 * Same tests as spike-cdp-test.mjs but connecting through the relay
 * instead of directly to Chrome.
 *
 * Prerequisites:
 *   1. Chrome with --remote-debugging-port=9222
 *   2. node spike-cdp-relay.mjs (running in another terminal or background)
 *
 * Usage:
 *   node spike-cdp-test-relay.mjs
 */

import { chromium } from '@xmorse/playwright-core'

const RELAY_URL = process.env.RELAY_URL || 'http://127.0.0.1:3400'

async function main() {
  console.log(`Connecting via relay at ${RELAY_URL}...`)

  let browser
  try {
    browser = await chromium.connectOverCDP(RELAY_URL)
    console.log('✓ Connected through relay')
  } catch (e) {
    console.error(`✗ Failed to connect: ${e.message}`)
    console.error('\nMake sure the relay is running: node spike-cdp-relay.mjs')
    process.exit(1)
  }

  const contexts = browser.contexts()
  console.log(`✓ Found ${contexts.length} browser context(s)`)

  const allPages = contexts.flatMap(c => c.pages())
  console.log(`✓ Found ${allPages.length} page(s)`)

  let page = allPages[0]
  if (!page) {
    const ctx = contexts[0] || await browser.newContext()
    page = await ctx.newPage()
  }

  // Test 1: Navigate
  console.log('\n--- Test 1: Navigate ---')
  try {
    await page.goto('https://example.com', { timeout: 10000 })
    console.log(`✓ Navigated to ${page.url()}`)
  } catch (e) {
    console.error(`✗ Navigate failed: ${e.message}`)
  }

  // Test 2: Evaluate
  console.log('\n--- Test 2: page.evaluate() ---')
  try {
    const title = await page.evaluate(() => document.title)
    console.log(`✓ document.title = "${title}"`)
  } catch (e) {
    console.error(`✗ Evaluate failed: ${e.message}`)
  }

  // Test 3: Screenshot (Playwright API)
  console.log('\n--- Test 3: page.screenshot() ---')
  try {
    const buf = await Promise.race([
      page.screenshot({ type: 'png' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 5s')), 5000))
    ])
    console.log(`✓ Screenshot: ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)`)
    const fs = await import('fs')
    fs.writeFileSync('/tmp/spike-relay-screenshot.png', buf)
    console.log(`✓ Saved to /tmp/spike-relay-screenshot.png`)
  } catch (e) {
    console.log(`⚠ Playwright screenshot: ${e.message}`)
    // Try raw CDP
    try {
      const cdp = await page.context().newCDPSession(page)
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const buf = Buffer.from(data, 'base64')
      console.log(`✓ CDP screenshot fallback: ${buf.length} bytes`)
      await cdp.detach()
    } catch (e2) {
      console.error(`✗ CDP screenshot also failed: ${e2.message}`)
    }
  }

  // Test 4: Locator
  console.log('\n--- Test 4: Locator ---')
  try {
    const locator = page.locator('a').first()
    const box = await locator.boundingBox()
    const text = await locator.textContent()
    console.log(`✓ Link: "${text?.trim()}" at ${JSON.stringify(box)}`)
  } catch (e) {
    console.error(`✗ Locator failed: ${e.message}`)
  }

  // Test 5: CDP a11y tree
  console.log('\n--- Test 5: A11y tree (CDP) ---')
  try {
    const cdp = await page.context().newCDPSession(page)
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    console.log(`✓ ${nodes.length} a11y nodes`)
    const interactive = nodes.filter(n =>
      n.role?.value && ['link', 'button', 'textbox', 'heading'].includes(n.role.value)
    )
    for (const n of interactive) {
      console.log(`    - ${n.role.value}: "${n.name?.value || '(unnamed)'}"`)
    }
    await cdp.detach()
  } catch (e) {
    console.error(`✗ A11y failed: ${e.message}`)
  }

  console.log('\n=== All relay tests complete ===')

  // Disconnect without killing the browser
  try { browser.close && await browser.close() } catch {}
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
