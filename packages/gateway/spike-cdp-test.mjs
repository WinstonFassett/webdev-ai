#!/usr/bin/env node
/**
 * Spike Phase 0.1: Test @xmorse/playwright-core connectOverCDP
 *
 * Prerequisites:
 *   Launch Chrome with:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp-test
 *
 * Then run: node spike-cdp-test.mjs
 */

import { chromium } from '@xmorse/playwright-core'

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222'

async function main() {
  console.log(`Connecting to Chrome CDP at ${CDP_URL}...`)

  let browser
  try {
    browser = await chromium.connectOverCDP(CDP_URL)
    console.log('✓ Connected to Chrome')
  } catch (e) {
    console.error(`✗ Failed to connect: ${e.message}`)
    console.error('\nMake sure Chrome is running with --remote-debugging-port=9222')
    console.error('  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp-test')
    process.exit(1)
  }

  // Get existing contexts and pages
  const contexts = browser.contexts()
  console.log(`✓ Found ${contexts.length} browser context(s)`)

  const allPages = contexts.flatMap(c => c.pages())
  console.log(`✓ Found ${allPages.length} page(s):`)
  for (const p of allPages) {
    console.log(`    - ${p.url()}`)
  }

  // Use first page or create one
  let page = allPages[0]
  if (!page) {
    console.log('No pages found, creating one...')
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

    const dims = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    console.log(`✓ viewport = ${dims.width}x${dims.height}`)
  } catch (e) {
    console.error(`✗ Evaluate failed: ${e.message}`)
  }

  // Test 3: Screenshot via Playwright API
  console.log('\n--- Test 3a: page.screenshot() (Playwright API) ---')
  try {
    // connectOverCDP can hang on font loading; use CDP directly as fallback
    const buf = await Promise.race([
      page.screenshot({ type: 'png' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after 5s')), 5000))
    ])
    console.log(`✓ Screenshot captured: ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)`)
    const fs = await import('fs')
    fs.writeFileSync('/tmp/spike-cdp-screenshot-pw.png', buf)
    console.log(`✓ Saved to /tmp/spike-cdp-screenshot-pw.png`)
  } catch (e) {
    console.log(`⚠ Playwright screenshot timed out (known connectOverCDP issue): ${e.message}`)
    console.log('  Will test via raw CDP instead...')
  }

  // Test 3b: Screenshot via raw CDP (the reliable path)
  console.log('\n--- Test 3b: Page.captureScreenshot (raw CDP) ---')
  try {
    const cdp = await page.context().newCDPSession(page)
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const buf = Buffer.from(data, 'base64')
    console.log(`✓ CDP screenshot: ${buf.length} bytes (${(buf.length / 1024).toFixed(1)} KB)`)
    const fs = await import('fs')
    fs.writeFileSync('/tmp/spike-cdp-screenshot-raw.png', buf)
    console.log(`✓ Saved to /tmp/spike-cdp-screenshot-raw.png`)
    await cdp.detach()
  } catch (e) {
    console.error(`✗ CDP screenshot failed: ${e.message}`)
  }

  // Test 4: Click
  console.log('\n--- Test 4: page.click() ---')
  try {
    // example.com has an <a> link
    const linkText = await page.evaluate(() => {
      const a = document.querySelector('a')
      return a ? a.textContent : null
    })
    if (linkText) {
      console.log(`✓ Found link: "${linkText.trim()}"`)
      // Don't actually click (would navigate away), just verify locator works
      const locator = page.locator('a').first()
      const box = await locator.boundingBox()
      console.log(`✓ Link bounding box: ${JSON.stringify(box)}`)
    } else {
      console.log('⚠ No links found on page')
    }
  } catch (e) {
    console.error(`✗ Click test failed: ${e.message}`)
  }

  // Test 5: Accessibility via raw CDP (page.accessibility.snapshot() may not exist on fork)
  console.log('\n--- Test 5: Accessibility tree (raw CDP) ---')
  try {
    const cdp = await page.context().newCDPSession(page)
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    console.log(`✓ Accessibility.getFullAXTree: ${nodes.length} nodes`)

    const interactive = nodes.filter(n =>
      n.role?.value && ['link', 'button', 'textbox', 'heading'].includes(n.role.value)
    )
    console.log(`  Interactive/heading nodes: ${interactive.length}`)
    for (const n of interactive.slice(0, 5)) {
      console.log(`    - ${n.role.value}: "${n.name?.value || '(unnamed)'}" backendDOMNodeId=${n.backendDOMNodeId}`)
    }

    // Get DOM tree
    const { root } = await cdp.send('DOM.getDocument', { depth: 3 })
    console.log(`✓ DOM.getDocument: root nodeId=${root.nodeId}, childCount=${root.childNodeCount}`)

    await cdp.detach()
  } catch (e) {
    console.error(`✗ A11y/DOM test failed: ${e.message}`)
  }

  console.log('\n=== All tests complete ===')

  // Don't close the browser — it's the user's Chrome
  // browser.close() would kill their browser
  await browser.disconnect()
  console.log('Disconnected (browser still running)')
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
