import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { intro, outro, log, note, spinner, select, multiselect, isCancel, cancel } from '@clack/prompts'
import { detect } from 'package-manager-detector'
import { execa } from 'execa'
import pc from 'picocolors'
import { autoRegister } from './auto-register.js'

const VITE_PLUGIN_PKG = '@winstonfassett/webdev-vite'
const ASTRO_PKG = '@winstonfassett/webdev-astro'
const NEXTJS_PKG = '@winstonfassett/webdev-next'
const NEXTJS_INIT_PATH = '@winstonfassett/webdev-next/init'
const GATEWAY_PKG = '@winstonfassett/webdev-gateway'
const VITE_PLUGIN_NAME = 'webdev'
const ASTRO_NAME = 'webdev'
const NEXTJS_WRAP = 'withWebdev'
const NEXTJS_INIT_COMPONENT = 'WebdevInit'
const STORYBOOK_PRESET = '@winstonfassett/webdev-vite/storybook'

export type InitOptions = {
  cwd: string
  port: number
  skipInstall?: boolean
  skipMcp?: boolean
  /** Non-interactive: auto-accept all prompts (CI / scripting). */
  yes?: boolean
}

export type Framework =
  | { name: 'vite'; projectDir: string; configPath: string }
  | { name: 'storybook'; projectDir: string; configPath: string }
  | { name: 'astro'; projectDir: string; configPath: string }
  | { name: 'next'; projectDir: string; configPath: string; bundler: 'webpack' | 'turbopack'; layoutPath: string | null }

export const ADAPTER_PACKAGES = {
  vite: VITE_PLUGIN_PKG,
  storybook: VITE_PLUGIN_PKG,
  astro: ASTRO_PKG,
  next: NEXTJS_PKG,
} as const

export { VITE_PLUGIN_PKG, ASTRO_PKG, NEXTJS_PKG, NEXTJS_INIT_PATH, GATEWAY_PKG }

type WireResult =
  | { status: 'edited' }
  | { status: 'already' }
  | { status: 'manual'; manualSteps: string }

export async function runInit(opts: InitOptions): Promise<void> {
  intro(pc.cyan('webdev init'))

  const frameworks = await detectFrameworks(opts.cwd, { yes: opts.yes })
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
    const parseFailures: Array<{ path: string; reason: string }> = []
    const permissionFailures: Array<{ path: string; reason: string }> = []
    const registered = autoRegister(opts.cwd, mcpUrl, {
      onParseError: (path, err) => parseFailures.push({ path, reason: err.message }),
      onPermissionError: (path, err) => permissionFailures.push({ path, reason: err.message }),
    })
    if (parseFailures.length > 0) {
      log.warn('Could not parse existing MCP config files (skipped):')
      for (const f of parseFailures) log.warn(`  ${pc.dim(f.path)}: ${f.reason}`)
    }
    if (permissionFailures.length > 0) {
      log.warn('Permission denied writing MCP config files:')
      for (const f of permissionFailures) log.warn(`  ${pc.dim(f.path)}: ${f.reason}`)
    }
    if (registered.length === 0) {
      log.warn('No MCP client configs were written.')
    } else {
      note(registered.map((p) => pc.green(`✓ ${p}`)).join('\n'), 'Registered with')
    }
  } else {
    log.info(pc.dim('Skipped MCP registration (--skip-mcp)'))
  }

  outro(pc.green(`Done. Run your dev server, then ${pc.cyan('npx webdev doctor')} to verify.`))
}

async function detectFrameworks(cwd: string, ctx: { yes?: boolean } = {}): Promise<Framework[]> {
  const direct = await detectFrameworksIn(cwd)
  if (direct.length > 0) return direct

  const subprojects = await scanMonorepoSubprojects(cwd)
  if (subprojects.length === 0) return []

  if (subprojects.length === 1) {
    const sp = subprojects[0]
    const rel = relPath(cwd, sp.dir)
    if (ctx.yes) {
      log.info(`Auto-accepted: wire ${sp.frameworks.map((f) => f.name).join(', ')} in ${rel}`)
      return sp.frameworks
    }
    const confirm = await select({
      message: `Found framework in ${rel}. Wire it?`,
      options: [
        { value: 'yes', label: `Yes — wire ${sp.frameworks.map((f) => f.name).join(', ')} in ${rel}` },
        { value: 'no', label: 'No, abort' },
      ],
      initialValue: 'yes',
    })
    if (isCancel(confirm) || confirm === 'no') {
      cancel('Aborted.')
      process.exit(0)
    }
    return sp.frameworks
  }

  if (ctx.yes) {
    log.info(`Auto-accepted: wiring ${subprojects.length} sub-projects (${subprojects.map((sp) => relPath(cwd, sp.dir)).join(', ')})`)
    return subprojects.flatMap((sp) => sp.frameworks)
  }

  const selectedDirs = await multiselect({
    message: 'Multiple sub-projects with framework configs found. Which to wire?',
    options: subprojects.map((sp) => ({
      value: sp.dir,
      label: `${relPath(cwd, sp.dir)} (${sp.frameworks.map((f) => f.name).join(', ')})`,
    })),
    initialValues: subprojects.map((sp) => sp.dir),
    required: true,
  })
  if (isCancel(selectedDirs)) {
    cancel('Aborted.')
    process.exit(0)
  }
  return subprojects
    .filter((sp) => (selectedDirs as string[]).includes(sp.dir))
    .flatMap((sp) => sp.frameworks)
}

export async function detectFrameworksIn(dir: string): Promise<Framework[]> {
  const found: Framework[] = []

  const nextPath = firstExisting(dir, ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.mts'])
  if (nextPath) {
    const bundler = await detectNextBundler(dir)
    const layoutPath = firstExisting(dir, ['app/layout.tsx', 'app/layout.jsx', 'src/app/layout.tsx', 'src/app/layout.jsx'])
    found.push({ name: 'next', projectDir: dir, configPath: nextPath, bundler, layoutPath })
  } else {
    const astroPath = firstExisting(dir, ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts'])
    if (astroPath) {
      found.push({ name: 'astro', projectDir: dir, configPath: astroPath })
    } else {
      const vitePath = firstExisting(dir, ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'])
      if (vitePath) found.push({ name: 'vite', projectDir: dir, configPath: vitePath })
    }
  }

  const sbPath = firstExisting(dir, ['.storybook/main.ts', '.storybook/main.js', '.storybook/main.mts', '.storybook/main.mjs'])
  if (sbPath) found.push({ name: 'storybook', projectDir: dir, configPath: sbPath })

  return found
}

/** Walk apps/* packages/* services/* examples/* for sub-projects with framework configs. */
async function scanMonorepoSubprojects(cwd: string): Promise<Array<{ dir: string; frameworks: Framework[] }>> {
  const out: Array<{ dir: string; frameworks: Framework[] }> = []
  const candidateRoots = ['apps', 'packages', 'services', 'examples']
  for (const root of candidateRoots) {
    const rootPath = join(cwd, root)
    if (!existsSync(rootPath)) continue
    let entries: string[] = []
    try { entries = readdirSync(rootPath) } catch { continue }
    for (const entry of entries) {
      const subdir = join(rootPath, entry)
      try { if (!statSync(subdir).isDirectory()) continue } catch { continue }
      const fws = await detectFrameworksIn(subdir)
      if (fws.length > 0) out.push({ dir: subdir, frameworks: fws })
    }
  }
  return out
}

/**
 * Detect Next.js bundler. Cascade per Sentry-wizard pattern + Next 16 default flip:
 *   1. only `--webpack` in any script → webpack
 *   2. only `--turbopack`/`--turbo` in any script → turbopack
 *   3. BOTH flags in different scripts → ask the user (default to whatever the
 *      bare `dev` script uses)
 *   4. neither flag, installed next version >= 16 → turbopack (default)
 *   5. neither flag, installed next version < 16 → webpack (default)
 *   6. unknown → assume turbopack
 */
async function detectNextBundler(cwd: string): Promise<'webpack' | 'turbopack'> {
  const pkgJsonPath = join(cwd, 'package.json')
  let pkgJson: any = null
  if (existsSync(pkgJsonPath)) {
    try { pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) } catch { /* fall through */ }
  }

  const scripts: Record<string, string> = pkgJson?.scripts ?? {}
  const allScriptText = Object.values(scripts).join(' ')
  const hasWebpack = allScriptText.includes('--webpack')
  const hasTurbopack = allScriptText.includes('--turbopack') || allScriptText.includes('--turbo')

  if (hasWebpack && hasTurbopack) {
    const devScript = scripts.dev ?? ''
    const devPrefers: 'webpack' | 'turbopack' =
      devScript.includes('--webpack') ? 'webpack' :
      devScript.includes('--turbopack') || devScript.includes('--turbo') ? 'turbopack' :
      'turbopack'
    const choice = await select({
      message: 'Both --webpack and --turbopack found in your scripts. Which to wire?',
      options: [
        { value: 'turbopack', label: 'turbopack — wraps next.config + adds <WebdevInit /> to layout' },
        { value: 'webpack', label: 'webpack — wraps next.config only (entry injection is automatic)' },
      ],
      initialValue: devPrefers,
    })
    if (isCancel(choice)) {
      cancel('Aborted.')
      process.exit(0)
    }
    return choice as 'webpack' | 'turbopack'
  }

  if (hasWebpack) return 'webpack'
  if (hasTurbopack) return 'turbopack'

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
  if (hasRealImport(source, VITE_PLUGIN_PKG) && hasCallExpression(source, VITE_PLUGIN_NAME)) {
    return { status: 'already' }
  }

  const withPlugin = insertIntoArrayField(source, 'plugins', `${VITE_PLUGIN_NAME}()`)
  if (withPlugin == null) {
    return { status: 'manual', manualSteps: viteManualSteps(configPath) }
  }

  const importLine = `import { ${VITE_PLUGIN_NAME} } from '${VITE_PLUGIN_PKG}'`
  const withImport = hasRealImport(withPlugin, VITE_PLUGIN_PKG)
    ? withPlugin
    : insertImportAfterLastImport(withPlugin, importLine)

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
  if (hasRealImport(source, ASTRO_PKG) && hasCallExpression(source, ASTRO_NAME)) {
    return { status: 'already' }
  }

  const withIntegration = insertIntoArrayField(source, 'integrations', `${ASTRO_NAME}()`)
  if (withIntegration == null) {
    return { status: 'manual', manualSteps: astroManualSteps(configPath) }
  }

  const importLine = `import ${ASTRO_NAME} from '${ASTRO_PKG}'`
  const withImport = hasRealImport(withIntegration, ASTRO_PKG)
    ? withIntegration
    : insertImportAfterLastImport(withIntegration, importLine)

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
  if (hasRealImport(source, NEXTJS_PKG) && hasCallExpression(source, NEXTJS_WRAP)) {
    return { status: 'already' }
  }

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
  if (!hasRealImport(updated, NEXTJS_PKG)) {
    updated = insertImportAfterLastImport(updated, importLine)
  }

  writeFileSync(configPath, updated, 'utf8')
  return { status: 'edited' }
}

function injectInitIntoLayout(layoutPath: string): WireResult {
  const source = readFileSync(layoutPath, 'utf8')
  if (hasRealImport(source, NEXTJS_INIT_PATH) && /<WebDevMcpInit\b/.test(source)) {
    return { status: 'already' }
  }

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
  if (!hasRealImport(updated, NEXTJS_INIT_PATH)) {
    updated = insertImportAfterLastImport(updated, importLine)
  }

  writeFileSync(layoutPath, updated, 'utf8')
  return { status: 'edited' }
}

/**
 * Check if a framework is fully wired (both import + wiring expression present).
 * Re-exported as the basis for `doctor` checks.
 */
export function isWired(fw: Framework): boolean {
  if (!existsSync(fw.configPath)) return false
  const source = readFileSync(fw.configPath, 'utf8')
  if (fw.name === 'vite') {
    return hasRealImport(source, VITE_PLUGIN_PKG) && hasCallExpression(source, VITE_PLUGIN_NAME)
  }
  if (fw.name === 'astro') {
    return hasRealImport(source, ASTRO_PKG) && hasCallExpression(source, ASTRO_NAME)
  }
  if (fw.name === 'storybook') {
    return source.includes(STORYBOOK_PRESET)
  }
  if (fw.name === 'next') {
    const cfgWired = hasRealImport(source, NEXTJS_PKG) && hasCallExpression(source, NEXTJS_WRAP)
    if (fw.bundler === 'webpack') return cfgWired
    if (!fw.layoutPath || !existsSync(fw.layoutPath)) return false
    const layoutSource = readFileSync(fw.layoutPath, 'utf8')
    const layoutWired = hasRealImport(layoutSource, NEXTJS_INIT_PATH) && /<WebDevMcpInit\b/.test(layoutSource)
    return cfgWired && layoutWired
  }
  return false
}

/**
 * Check if a real `import ... from '<pkg>'` line is present (not a commented-out one).
 * Anchors to start-of-line + optional whitespace + literal `import` keyword, so `// import ...`
 * does not match.
 */
function hasRealImport(source: string, pkg: string): boolean {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^\\s*import\\b[^\\n;]*['"\`]${escaped}['"\`]`, 'm')
  return re.test(source)
}

/**
 * Check if a function call expression is present in the source.
 * Used as the second half of the "already wired" marker — paired with hasRealImport.
 * Comment-commented-out cases (e.g. `// webDevMcp()`) will incorrectly match;
 * acceptable since hasRealImport will fail in that case.
 */
function hasCallExpression(source: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\s*\\(`).test(source)
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
  // Group adapter package sets by project dir so deps land in the right
  // package.json (matters for monorepos where init at root wires sub-projects)
  const byDir = new Map<string, Set<string>>()
  for (const fw of frameworks) {
    const set = byDir.get(fw.projectDir) ?? new Set<string>([GATEWAY_PKG])
    if (fw.name === 'vite' || fw.name === 'storybook') set.add(VITE_PLUGIN_PKG)
    else if (fw.name === 'astro') set.add(ASTRO_PKG)
    else if (fw.name === 'next') set.add(NEXTJS_PKG)
    byDir.set(fw.projectDir, set)
  }

  for (const [projectDir, pkgSet] of byDir) {
    const pkgList = [...pkgSet]
    const detected = await detect({ cwd: projectDir })
    const agent = detected?.agent ?? 'npm'
    const verb = agent === 'npm' ? 'install' : 'add'
    const args = [verb, '-D', ...pkgList]

    const rel = relPath(cwd, projectDir) || '.'
    const s = spinner()
    s.start(`Installing ${pkgList.join(' + ')} in ${rel} via ${agent}`)
    try {
      await execa(agent, args, { cwd: projectDir })
      s.stop(`Installed in ${rel} via ${agent}`)
    } catch (err) {
      s.stop(pc.red(`Install failed in ${rel}`))
      log.error((err as Error).message)
      throw err
    }
  }
}

export function relPath(cwd: string, p: string): string {
  return p.startsWith(cwd) ? p.slice(cwd.length + 1) : p
}
