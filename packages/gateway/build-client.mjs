import { build } from 'esbuild'

// Build browser client (injected into pages)
await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/web-dev-mcp-client.js',
  minify: true,
})
console.log('Client bundle built → dist/web-dev-mcp-client.js')

// Build modern-screenshot as a standalone ESM module for lazy loading
// Served at /__libs/modern-screenshot.js, preloaded on idle
await build({
  entryPoints: ['modern-screenshot'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/libs/modern-screenshot.js',
  minify: true,
})
console.log('Screenshot lib built → dist/libs/modern-screenshot.js')

// Build element-source if installed (optional — enhances React 19 + Next.js source resolution)
// Served at /__libs/element-source.js, detected at runtime by source-resolver.ts
try {
  await import.meta.resolve('element-source')
  await build({
    entryPoints: ['element-source'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/libs/element-source.js',
    minify: true,
  })
  console.log('Element-source lib built → dist/libs/element-source.js (optional)')
} catch {
  console.log('Element-source not installed — skipping (optional)')
}

// Build element-grab overlay (vanilla TS, no framework)
// Lazy-loaded by client.js, served at /__element-grab.js
await build({
  entryPoints: ['src/client/element-grab/index.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/element-grab-client.js',
  minify: true,
  loader: { '.css': 'text' },
})
console.log('Element-grab built → dist/element-grab-client.js')
