// Simple import smoke test - verifies all package exports resolve
import assert from 'node:assert'

// Gateway helpers export
import { ensureGateway, registerWithRetry, patchConsole, connectDevEvents, makeServerId } from '@winstonfassett/webdev-gateway/helpers'
assert(typeof ensureGateway === 'function', 'ensureGateway should be a function')
assert(typeof registerWithRetry === 'function', 'registerWithRetry should be a function')
assert(typeof patchConsole === 'function', 'patchConsole should be a function')
assert(typeof connectDevEvents === 'function', 'connectDevEvents should be a function')
assert(typeof makeServerId === 'function', 'makeServerId should be a function')
console.log('✓ Gateway helpers exports resolve')

// Vite adapter export
import { webdev } from '@winstonfassett/webdev-vite'
assert(typeof webdev === 'function', 'webdev should be a function')
console.log('✓ Vite adapter main export resolves')

// Vite storybook preset (ESM)
import preset from '@winstonfassett/webdev-vite/storybook'
assert(typeof preset === 'object', 'storybook preset should be an object')
console.log('✓ Vite storybook preset (ESM) resolves')

// Next.js adapter exports
import { withWebdev } from '@winstonfassett/webdev-next'
assert(typeof withWebdev === 'function', 'withWebdev should be a function')
console.log('✓ Next.js adapter main export resolves')

import { WebDevMcpInit } from '@winstonfassett/webdev-next/init'
assert(typeof WebDevMcpInit === 'function', 'WebDevMcpInit should be a function')
console.log('✓ Next.js init export resolves')

import instrument from '@winstonfassett/webdev-next/instrument'
assert(typeof instrument === 'string' || typeof instrument === 'function', 'instrument should be a module')
console.log('✓ Next.js instrument export resolves')

// Astro adapter export
import webdevAstro from '@winstonfassett/webdev-astro'
assert(typeof webdevAstro === 'function', 'webdevAstro should be a function')
console.log('✓ Astro adapter export resolves')

console.log('\n✅ All package exports smoke test passed')
