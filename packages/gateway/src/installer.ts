import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { intro, outro, log, note, spinner } from '@clack/prompts'
import { detect } from 'package-manager-detector'
import { execa } from 'execa'
import pc from 'picocolors'
import { autoRegister } from './auto-register.js'

const VITE_PLUGIN_PKG = '@winstonfassett/web-dev-mcp-vite'
const ASTRO_PKG = '@winstonfassett/web-dev-mcp-astro'
const NEXTJS_PKG = '@winstonfassett/web-dev-mcp-nextjs'
const NEXTJS_INIT_PATH = '@winstonfassett/web-dev-mcp-nextjs/init'
const GATEWAY_PKG = '@winstonfassett/web-dev-mcp-gateway'
const VITE_PLUGIN_NAME = 'webDevMcp'
const ASTRO_NAME = 'webDevMcp'
const NEXTJS_WRAP = 'withWebDevMcp'
const NEXTJS_INIT_COMPONENT = 'WebDevMcpInit'
const STORYBOOK_PRESET = '@winstonfassett/web-dev-mcp-vite/storybook'

export type InitOptions = {
  cwd: string
  port: number
  skipInstall?: boolean
  skipMcp?: boolean
}

type Framework =
  | { name: 'vite'; configPath: string }
  | { name: 'storybook'; configPath: string }
  | { name: 'astro'; configPath: string }
  | { name: 'next'; configPath: string; bundler: 'webpack' | 'turbopack'; layoutPath: string | null }

type WireResult =
  | { status: 'edited' }
  | { status: 'already' }
  | { status: 'manual'; manualSteps: string }

export async function runInit(opts: InitOptions): Promise<void> {
  intro(pc.cyan('web-dev-mcp init'))

  const frameworks = detectFrameworks(opts.cwd)
  if (frameworks.length === 0) {
    log.error('No supported framework detected. Looked for: vite.config.*, .storybook/main.*, astro.config.*, next.config.*')
    outro(pc.red('Aborted.'))
    process.exitCode = 1
    return
  }
  log.info(`Detected: ${frameworks.map((f) => pc.green(f.name)).join(', ')}`)

  for (const fw of frameworks) {
    const wire = wireFramework(fw)
    const rel = relPath(opts.cwd, fw.configPath)
    if (wire.status === 'already') {
      log.info(`${fw.name}: already wired (${pc.dim(rel)})`)
    } else if (wire.status === 'edited') {
      log.success(`${fw.name}: edited ${pc.dim(rel)}`)
    } else {
      log.warn(`${fw.name}: could not safely edit ${pc.dim(rel)}`)
      note(wire.manualSteps, `Manual steps for ${fw.name}`)
    }
  }

  if (!opts.skipInstall) {
    await installAdapters(opts.cwd, frameworks)
  } else {
    log.info(pc.dim('Skipped npm install (--skip-install)'))
  }

  if (!opts.skipMcp) {
    const mcpUrl = `http://localhost:${opts.port}/__mcp/sse`
    const registered = autoRegister(opts.cwd, mcpUrl)
    if (registered.length === 0) {
      log.warn('No MCP client configs were written.')
    } else {
      note(registered.map((p) => pc.green(`✓ ${p}`)).join('\n'), 'Registered with')
    }
  } else {
    log.info(pc.dim('Skipped MCP registration (--skip-mcp)'))
  }

  outro(pc.green('Done. Run your dev server.'))
}

function detectFrameworks(cwd: string): Framework[] {
  const found: Framework[] = []

  // Next.js — exclusive with vite (next has its own bundler). Detect first so we
  // don't double-wire if next.config also has a vite shim somehow.
  const nextPath = firstExisting(cwd, ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.mts'])
  if (nextPath) {
    const bundler = detectNextBundler(cwd)
    const layoutPath = firstExisting(cwd, ['app/layout.tsx', 'app/layout.jsx', 'src/app/layout.tsx', 'src/app/layout.jsx'])
    found.push({ name: 'next', configPath: nextPath, bundler, layoutPath })
  } else {
    // Astro takes precedence over vite — astro uses vite under the hood but
    // should only get the astro integration.
    const astroPath = firstExisting(cwd, ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts'])
    if (astroPath) {
      found.push({ name: 'astro', configPath: astroPath })
    } else {
      const vitePath = firstExisting(cwd, ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'])
      if (vitePath) found.push({ name: 'vite', configPath: vitePath })
    }
  }

  const sbPath = firstExisting(cwd, ['.storybook/main.ts', '.storybook/main.js', '.storybook/main.mts', '.storybook/main.mjs'])
  if (sbPath) found.push({ name: 'storybook', configPath: sbPath })

  return found
}

/**
 * Detect Next.js bundler. Cascade per Sentry-wizard pattern + Next 16 default flip:
 *   1. dev script contains `--webpack` → webpack
 *   2. dev script contains `--turbopack` or `--turbo` → turbopack
 *   3. installed next version >= 16 → turbopack (default)
 *   4. installed next version < 16 → webpack (default)
 *   5. unknown → assume turbopack (Next 16 is current; safer to inject the init
 *      component than to silently break)
 */
function detectNextBundler(cwd: string): 'webpack' | 'turbopack' {
  const pkgJsonPath = join(cwd, 'package.json')
  let pkgJson: any = null
  if (existsSync(pkgJsonPath)) {
    try { pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) } catch { /* fall through */ }
  }

  const scripts: Record<string, string> = pkgJson?.scripts ?? {}
  const allScriptText = Object.values(scripts).join(' ')
  if (allScriptText.includes('--webpack')) return 'webpack'
  if (allScriptText.includes('--turbopack') || allScriptText.includes('--turbo')) return 'turbopack'

  const nextVersion = pkgJson?.dependencies?.next ?? pkgJson?.devDependencies?.next
  if (typeof nextVersion === 'string') {
    const major = parseInt(nextVersion.replace(/^[^\d]*/, ''), 10)
    if (!Number.isNaN(major)) return major >= 16 ? 'turbopack' : 'webpack'
  }

  return 'turbopack'
}

function firstExisting(cwd: string, files: string[]): string | null {
  for (const f of files) {
    const p = join(cwd, f)
    if (existsSync(p)) return p
  }
  return null
}

function wireFramework(fw: Framework): WireResult {
  if (fw.name === 'vite') return wireVite(fw.configPath)
  if (fw.name === 'storybook') return wireStorybook(fw.configPath)
  if (fw.name === 'astro') return wireAstro(fw.configPath)
  if (fw.name === 'next') return wireNext(fw)
  return { status: 'manual', manualSteps: 'Unknown framework' }
}

function wireVite(configPath: string): WireResult {
  const source = readFileSync(configPath, 'utf8')
  if (source.includes(VITE_PLUGIN_PKG)) return { status: 'already' }

  const withPlugin = insertIntoArrayField(source, 'plugins', `${VITE_PLUGIN_NAME}()`)
  if (withPlugin == null) {
    return { status: 'manual', manualSteps: viteManualSteps(configPath) }
  }

  const importLine = `import { ${VITE_PLUGIN_NAME} } from '${VITE_PLUGIN_PKG}'`
  const withImport = insertImportAfterLastImport(withPlugin, importLine)

  writeFileSync(configPath, withImport, 'utf8')
  return { status: 'edited' }
}

function wireStorybook(configPath: string): WireResult {
  const source = readFileSync(configPath, 'utf8')
  if (source.includes(STORYBOOK_PRESET)) return { status: 'already' }

  const updated = insertIntoArrayField(source, 'addons', `'${STORYBOOK_PRESET}'`)
  if (updated == null) {
    return { status: 'manual', manualSteps: storybookManualSteps(configPath) }
  }
  writeFileSync(configPath, updated, 'utf8')
  return { status: 'edited' }
}

function wireAstro(configPath: string): WireResult {
  const source = readFileSync(configPath, 'utf8')
  if (source.includes(ASTRO_PKG)) return { status: 'already' }

  const withIntegration = insertIntoArrayField(source, 'integrations', `${ASTRO_NAME}()`)
  if (withIntegration == null) {
    return { status: 'manual', manualSteps: astroManualSteps(configPath) }
  }

  const importLine = `import ${ASTRO_NAME} from '${ASTRO_PKG}'`
  const withImport = insertImportAfterLastImport(withIntegration, importLine)

  writeFileSync(configPath, withImport, 'utf8')
  return { status: 'edited' }
}

function wireNext(fw: Extract<Framework, { name: 'next' }>): WireResult {
  // 1. Wrap-the-export in next.config.*
  const configResult = wrapNextConfig(fw.configPath)
  if (configResult.status === 'manual') return configResult

  // 2. Turbopack only: insert <WebDevMcpInit /> in layout.tsx
  if (fw.bundler === 'webpack') return configResult
  if (!fw.layoutPath) {
    // Turbopack but no root layout found — config edited but init not injected
    return {
      status: 'manual',
      manualSteps: nextLayoutManualSteps('app/layout.tsx (or src/app/layout.tsx)'),
    }
  }
  const layoutResult = injectInitIntoLayout(fw.layoutPath)
  if (layoutResult.status === 'manual') return layoutResult
  // Both succeeded (or were already wired)
  return configResult.status === 'already' && layoutResult.status === 'already'
    ? { status: 'already' }
    : { status: 'edited' }
}

function wrapNextConfig(configPath: string): WireResult {
  const source = readFileSync(configPath, 'utf8')
  if (source.includes(NEXTJS_PKG)) return { status: 'already' }

  // Match `export default <expr>;?` (single line, expr is identifier or simple call).
  // Use [ \t]* (not \s*) to avoid consuming the trailing newline.
  const exportRe = /^export default ([^;\n]+?)(;?)[ \t]*$/m
  const cjsRe = /^module\.exports[ \t]*=[ \t]*([^;\n]+?)(;?)[ \t]*$/m
  let m = source.match(exportRe)
  let isEsm = true
  if (!m) {
    m = source.match(cjsRe)
    isEsm = false
  }
  if (!m) {
    return { status: 'manual', manualSteps: nextConfigManualSteps(configPath) }
  }

  const expr = m[1].trim()
  const semi = m[2]
  const wrappedLine = isEsm
    ? `export default ${NEXTJS_WRAP}(${expr})${semi}`
    : `module.exports = ${NEXTJS_WRAP}(${expr})${semi}`

  let updated = source.replace(m[0], wrappedLine)

  // Quote style: match what the file uses
  const quote = source.includes(`from "`) ? '"' : `'`
  const importLine = `import { ${NEXTJS_WRAP} } from ${quote}${NEXTJS_PKG}${quote}`
  updated = insertImportAfterLastImport(updated, importLine)

  writeFileSync(configPath, updated, 'utf8')
  return { status: 'edited' }
}

function injectInitIntoLayout(layoutPath: string): WireResult {
  const source = readFileSync(layoutPath, 'utf8')
  if (source.includes(NEXTJS_INIT_PATH)) return { status: 'already' }

  // Find <body ...> opening tag (not </body>, not <body/>)
  const bodyOpenRe = /<body\b[^>]*>/
  const m = source.match(bodyOpenRe)
  if (!m) {
    return { status: 'manual', manualSteps: nextLayoutManualSteps(layoutPath) }
  }
  const insertAt = m.index! + m[0].length

  // Determine indent: peek at the next non-empty line after `<body>` to copy its indent
  const after = source.slice(insertAt)
  const nextLineMatch = after.match(/\n(\s*)\S/)
  const childIndent = nextLineMatch?.[1] ?? '        '

  const insertion = `\n${childIndent}<${NEXTJS_INIT_COMPONENT} />`
  let updated = source.slice(0, insertAt) + insertion + source.slice(insertAt)

  // Quote style match for the import
  const quote = source.includes(`from "`) ? '"' : `'`
  const importLine = `import { ${NEXTJS_INIT_COMPONENT} } from ${quote}${NEXTJS_INIT_PATH}${quote}`
  updated = insertImportAfterLastImport(updated, importLine)

  writeFileSync(layoutPath, updated, 'utf8')
  return { status: 'edited' }
}

/**
 * Insert an entry into a `<field>: [...]` array. Entry can be any code (string
 * literal with quotes, function call, etc.). Preserves user's indentation and
 * inline-vs-multiline style. Returns null if the array can't be located safely.
 */
function insertIntoArrayField(source: string, field: string, entry: string): string | null {
  const fieldRe = new RegExp(`(^|[^\\w$])${field}\\s*:\\s*\\[`)
  const m = source.match(fieldRe)
  if (!m) return null

  const arrayOpenIdx = m.index! + m[0].length - 1
  let depth = 1
  let i = arrayOpenIdx + 1
  let str: string | null = null
  while (i < source.length && depth > 0) {
    const c = source[i]
    if (str) {
      if (c === '\\') { i += 2; continue }
      if (c === str) str = null
    } else if (c === '"' || c === "'" || c === '`') {
      str = c
    } else if (c === '[') depth++
    else if (c === ']') depth--
    if (depth === 0) break
    i++
  }
  if (depth !== 0) return null
  const closeIdx = i

  const arrayContents = source.slice(arrayOpenIdx + 1, closeIdx)
  const isEmpty = arrayContents.trim() === ''
  const isInline = !arrayContents.includes('\n')

  // Inline empty: `plugins: []` → `plugins: [entry]`
  if (isEmpty && isInline) {
    return source.slice(0, arrayOpenIdx + 1) + entry + source.slice(closeIdx)
  }

  // Inline non-empty: `plugins: [a(), b()]` → `plugins: [a(), b(), entry]`
  if (isInline) {
    const beforeClose = arrayContents.replace(/\s+$/, '')
    const lastChar = beforeClose[beforeClose.length - 1]
    const sep = lastChar === ',' ? ' ' : ', '
    return source.slice(0, arrayOpenIdx + 1) + beforeClose + sep + entry + source.slice(closeIdx)
  }

  // Multi-line. Indent of `]`'s line.
  const closeLineStart = source.lastIndexOf('\n', closeIdx - 1) + 1
  const closeLineIndent = source.slice(closeLineStart, closeIdx).match(/^\s*/)?.[0] ?? ''

  if (isEmpty) {
    return source.slice(0, arrayOpenIdx + 1) + `\n${closeLineIndent}  ${entry},\n${closeLineIndent}` + source.slice(closeIdx)
  }

  // Find item indent from last non-empty line in the array
  let itemIndent = closeLineIndent + '  '
  const lines = arrayContents.split('\n')
  for (let li = lines.length - 1; li >= 0; li--) {
    const line = lines[li]
    if (line.trim() === '') continue
    const indent = line.match(/^\s*/)?.[0] ?? ''
    if (indent.length > 0) itemIndent = indent
    break
  }

  const beforeTrim = arrayContents.replace(/\s+$/, '')
  const lastChar = beforeTrim[beforeTrim.length - 1]
  const needsComma = lastChar !== ',' && lastChar !== '['

  const insertion = `${needsComma ? ',' : ''}\n${itemIndent}${entry},\n${closeLineIndent}`
  return source.slice(0, arrayOpenIdx + 1) + beforeTrim + insertion + source.slice(closeIdx)
}

/**
 * Insert an import statement on its own line after the last existing import.
 * Matches the file's existing semicolon style. Falls back to inserting at the
 * top of the file if no imports are found.
 */
function insertImportAfterLastImport(source: string, importLine: string): string {
  const importPattern = /^import\s+[^;]+?\s+from\s+['"][^'"]+['"];?\s*$/
  const lines = source.split('\n')
  let lastIdx = -1
  let usesSemicolons = false
  for (let i = 0; i < lines.length; i++) {
    if (importPattern.test(lines[i])) {
      lastIdx = i
      if (lines[i].trim().endsWith(';')) usesSemicolons = true
    }
  }
  const final = usesSemicolons && !importLine.trim().endsWith(';') ? importLine + ';' : importLine
  if (lastIdx === -1) {
    // No existing imports — add ours plus a blank line before existing code,
    // unless the source already starts with a blank line.
    const sep = source.startsWith('\n') ? '\n' : '\n\n'
    return final + sep + source
  }
  lines.splice(lastIdx + 1, 0, final)
  return lines.join('\n')
}

function viteManualSteps(configPath: string): string {
  return [
    `In ${configPath}:`,
    '',
    `  import { ${VITE_PLUGIN_NAME} } from '${VITE_PLUGIN_PKG}'`,
    '',
    '  export default defineConfig({',
    '    plugins: [',
    '      // ... your other plugins',
    `      ${VITE_PLUGIN_NAME}(),`,
    '    ],',
    '  })',
  ].join('\n')
}

function storybookManualSteps(configPath: string): string {
  return [
    `In ${configPath}:`,
    '',
    '  addons: [',
    '    // ... your other addons',
    `    '${STORYBOOK_PRESET}',`,
    '  ],',
  ].join('\n')
}

function astroManualSteps(configPath: string): string {
  return [
    `In ${configPath}:`,
    '',
    `  import ${ASTRO_NAME} from '${ASTRO_PKG}'`,
    '',
    '  export default defineConfig({',
    '    integrations: [',
    '      // ... your other integrations',
    `      ${ASTRO_NAME}(),`,
    '    ],',
    '  })',
  ].join('\n')
}

function nextConfigManualSteps(configPath: string): string {
  return [
    `In ${configPath}:`,
    '',
    `  import { ${NEXTJS_WRAP} } from '${NEXTJS_PKG}'`,
    '',
    '  // ... your config ...',
    '',
    `  export default ${NEXTJS_WRAP}(nextConfig)`,
  ].join('\n')
}

function nextLayoutManualSteps(layoutPath: string): string {
  return [
    `In ${layoutPath} (root layout, the one with <html><body>):`,
    '',
    `  import { ${NEXTJS_INIT_COMPONENT} } from '${NEXTJS_INIT_PATH}'`,
    '',
    '  // inside <body>:',
    `      <${NEXTJS_INIT_COMPONENT} />`,
    '      {children}',
  ].join('\n')
}

async function installAdapters(cwd: string, frameworks: Framework[]): Promise<void> {
  const pkgs = new Set<string>([GATEWAY_PKG])
  for (const fw of frameworks) {
    if (fw.name === 'vite' || fw.name === 'storybook') pkgs.add(VITE_PLUGIN_PKG)
    else if (fw.name === 'astro') pkgs.add(ASTRO_PKG)
    else if (fw.name === 'next') pkgs.add(NEXTJS_PKG)
  }
  const pkgList = [...pkgs]

  const detected = await detect({ cwd })
  const agent = detected?.agent ?? 'npm'
  const verb = agent === 'npm' ? 'install' : 'add'
  const args = [verb, '-D', ...pkgList]

  const s = spinner()
  s.start(`Installing ${pkgList.join(' + ')} via ${agent}`)
  try {
    await execa(agent, args, { cwd })
    s.stop(`Installed via ${agent}`)
  } catch (err) {
    s.stop(pc.red(`Install failed`))
    log.error((err as Error).message)
    throw err
  }
}

function relPath(cwd: string, p: string): string {
  return p.startsWith(cwd) ? p.slice(cwd.length + 1) : p
}
