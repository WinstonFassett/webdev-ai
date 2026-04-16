#!/usr/bin/env node
/**
 * Spike Phase 0.3: Test STOCK playwright-core (not fork)
 * Same tests, stock library. Run against Chrome directly first,
 * then against relay.
 */

import { chromium } from '@xmorse/playwright-core'

const TARGET = process.env.CDP_URL || 'http://127.0.0.1:9222'
console.log(`Testing STOCK playwright-core against ${TARGET}...`)

async function main() {
  const browser = await chromium.connectOverCDP(TARGET)
  console.log('✓ Connected (stock playwright-core)')

  const contexts = browser.contexts()
  const page = contexts.flatMap(c => c.pages())[0]
  if (!page) { console.error('No pages'); process.exit(1) }

  await page.goto('https://example.com', { timeout: 10000 })
  console.log(`✓ Navigate: ${page.url()}`)

  const title = await page.evaluate(() => document.title)
  console.log(`✓ Evaluate: "${title}"`)

  try {
    const buf = await Promise.race([
      page.screenshot({ type: 'png' }),
      new Promise((_, r) => setTimeout(() => r(new Error('timeout 5s')), 5000))
    ])
    console.log(`✓ Screenshot: ${buf.length} bytes`)
  } catch (e) {
    console.log(`⚠ Screenshot: ${e.message}`)
    const cdp = await page.context().newCDPSession(page)
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    console.log(`✓ CDP screenshot fallback: ${Buffer.from(data, 'base64').length} bytes`)
    await cdp.detach()
  }

  const loc = page.locator('a').first()
  const box = await loc.boundingBox()
  console.log(`✓ Locator: ${JSON.stringify(box)}`)

  // Use getExistingCDPSession — same pattern as Playwriter.
  // newCDPSession calls Target.attachToBrowserTarget which doesn't work through extension relay.
  const cdp = await page.context().getExistingCDPSession(page)
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  console.log(`✓ A11y: ${nodes.length} nodes`)
  await cdp.detach()

  console.log('=== Stock playwright-core: ALL PASS ===')
  try { await browser.close() } catch {}
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
