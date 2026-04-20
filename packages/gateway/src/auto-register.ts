import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { applyEdits, modify, parse, parseTree, type FormattingOptions } from 'jsonc-parser'

interface AgentConfig {
  relPath: string
  /** JSON key that holds the server map — VS Code uses "servers", others use "mcpServers" */
  serversKey: string
}

/** Project-level config paths (relative to cwd) */
const PROJECT_AGENTS: Record<string, AgentConfig> = {
  claude:   { relPath: '.mcp.json',           serversKey: 'mcpServers' },
  cursor:   { relPath: '.cursor/mcp.json',    serversKey: 'mcpServers' },
  windsurf: { relPath: '.windsurf/mcp.json',  serversKey: 'mcpServers' },
  vscode:   { relPath: '.vscode/mcp.json',    serversKey: 'servers' },
}

/** Global/user-level config paths (relative to home dir) */
const GLOBAL_AGENTS: Record<string, AgentConfig> = {
  claude:   { relPath: '.claude/settings.json', serversKey: 'mcpServers' },
  cursor:   { relPath: '.cursor/mcp.json',      serversKey: 'mcpServers' },
  windsurf: { relPath: '.windsurf/mcp.json',    serversKey: 'mcpServers' },
}

/** Optional callbacks for surfacing non-fatal events during auto-register */
export interface AutoRegisterReporter {
  onParseError?: (filePath: string, error: Error) => void
  onPermissionError?: (filePath: string, error: Error) => void
}

/**
 * Detect indentation from existing source. Returns 2 if file is empty/new or
 * indent can't be inferred — matches the common style for `.json` / `.mcp.json`.
 */
function detectIndent(source: string): number {
  const m = source.match(/\n([ \t]+)\S/)
  if (!m) return 2
  const indent = m[1]
  if (indent.startsWith('\t')) return 1
  return indent.length || 2
}

function detectEol(source: string): '\n' | '\r\n' {
  return source.includes('\r\n') ? '\r\n' : '\n'
}

function upsertMcpServer(filePath: string, serversKey: string, mcpUrl: string, reporter?: AutoRegisterReporter): boolean {
  const dir = dirname(filePath)

  const exists = existsSync(filePath)
  const original = exists ? readFileSync(filePath, 'utf-8') : ''

  // Validate parse first — surfaces JSONC-with-syntax-errors before we attempt edits.
  if (exists && original.trim() !== '') {
    try {
      const errors: Array<{ error: number; offset: number; length: number }> = []
      parse(original, errors, { allowTrailingComma: true })
      if (errors.length > 0) {
        const first = errors[0]
        throw new Error(`JSONC parse error at offset ${first.offset}`)
      }
    } catch (err) {
      if (reporter?.onParseError) reporter.onParseError(filePath, err as Error)
      else console.error(`  Skipped ${filePath}: could not parse existing JSON`)
      return false
    }
  }

  const formattingOptions: FormattingOptions = {
    tabSize: detectIndent(original || '{}'),
    insertSpaces: !(original.includes('\n\t')),
    eol: detectEol(original),
  }

  const serverEntry = { url: mcpUrl }

  let updated: string
  if (!exists || original.trim() === '') {
    // Fresh file: write a minimal well-formed object with our entry.
    const indent = ' '.repeat(formattingOptions.tabSize ?? 2)
    const eol = formattingOptions.eol ?? '\n'
    updated = `{${eol}${indent}"${serversKey}": {${eol}${indent}${indent}"web-dev-mcp": ${JSON.stringify(serverEntry)}${eol}${indent}}${eol}}${eol}`
  } else {
    // Existing file: precise edit via jsonc-parser. Only the targeted key changes;
    // comments, formatting, key order everywhere else are preserved byte-for-byte.
    const tree = parseTree(original, [], { allowTrailingComma: true })
    const hasServersKey = tree?.type === 'object' &&
      tree.children?.some((c) => c.type === 'property' && c.children?.[0]?.value === serversKey)

    if (!hasServersKey) {
      // Parent missing: insert the whole `serversKey: { 'web-dev-mcp': {...} }` block in one edit.
      const edits = modify(original, [serversKey], { 'web-dev-mcp': serverEntry }, { formattingOptions })
      updated = applyEdits(original, edits)
    } else {
      // Parent exists: just upsert our key. Replaces only the value if already present.
      const edits = modify(original, [serversKey, 'web-dev-mcp'], serverEntry, { formattingOptions })
      updated = applyEdits(original, edits)
    }
  }

  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, updated)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      if (reporter?.onPermissionError) reporter.onPermissionError(filePath, e)
      else console.error(`  Skipped ${filePath}: permission denied (${e.code})`)
      return false
    }
    throw err
  }
  return true
}

/** Register MCP in project-level config files */
export function autoRegister(cwd: string, mcpUrl: string, reporter?: AutoRegisterReporter): string[] {
  const registered: string[] = []

  for (const [_agent, { relPath, serversKey }] of Object.entries(PROJECT_AGENTS)) {
    const filePath = join(cwd, relPath)
    if (upsertMcpServer(filePath, serversKey, mcpUrl, reporter)) {
      registered.push(relPath)
    }
  }

  // Ensure .web-dev-mcp is gitignored
  ensureGitignore(cwd, '.web-dev-mcp')

  return registered
}

/** Register MCP in global/user-level config files */
export function autoRegisterGlobal(mcpUrl: string, reporter?: AutoRegisterReporter): string[] {
  const home = homedir()
  const registered: string[] = []

  for (const [_agent, { relPath, serversKey }] of Object.entries(GLOBAL_AGENTS)) {
    const filePath = join(home, relPath)
    // Only write to global configs that already exist (don't create dirs for tools the user doesn't have)
    if (!existsSync(dirname(filePath))) continue
    if (upsertMcpServer(filePath, serversKey, mcpUrl, reporter)) {
      registered.push(`~/${relPath}`)
    }
  }

  return registered
}

/** Add an entry to .gitignore if not already present */
function ensureGitignore(cwd: string, entry: string) {
  const gitignorePath = join(cwd, '.gitignore')
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8')
    if (content.split('\n').some(line => line.trim() === entry)) return
    const needsNewline = content.length > 0 && !content.endsWith('\n')
    appendFileSync(gitignorePath, (needsNewline ? '\n' : '') + entry + '\n')
  } else {
    writeFileSync(gitignorePath, entry + '\n')
  }
}
