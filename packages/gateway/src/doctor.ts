import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import http from 'node:http'
import { intro, outro, log, note } from '@clack/prompts'
import pc from 'picocolors'
import {
  detectFrameworksIn,
  isWired,
  relPath,
  ADAPTER_PACKAGES,
  GATEWAY_PKG,
  type Framework,
} from './installer.js'

export type DoctorOptions = {
  cwd: string
  port: number
}

export async function runDoctor(opts: DoctorOptions): Promise<void> {
  intro(pc.cyan('web-dev-mcp doctor'))

  let pass = 0
  let fail = 0
  let warn = 0

  // 1. Gateway reachable
  const gatewayOk = await checkGatewayReachable(opts.port)
  if (gatewayOk) {
    log.success(`Gateway responding at ${pc.dim(`http://localhost:${opts.port}`)}`)
    pass++
  } else {
    log.error(`Gateway not responding at ${pc.dim(`http://localhost:${opts.port}`)} — start it with ${pc.cyan('npm run dev')} (adapter auto-spawns) or ${pc.cyan('npx web-dev-mcp')}`)
    fail++
  }

  // 2. Detect framework + check wiring + check adapter installed
  const frameworks = await detectFrameworksIn(opts.cwd)
  if (frameworks.length === 0) {
    log.warn(`No supported framework config in ${pc.dim(opts.cwd)}. Skipping wiring + adapter checks. (Run ${pc.cyan('init')} from the directory containing your framework config.)`)
    warn++
  } else {
    for (const fw of frameworks) {
      const rel = relPath(opts.cwd, fw.configPath)
      if (isWired(fw)) {
        log.success(`${fw.name}: config wired ${pc.dim(`(${rel})`)}`)
        pass++
      } else {
        log.error(`${fw.name}: config NOT wired ${pc.dim(`(${rel})`)} — run ${pc.cyan('npx web-dev-mcp init')}`)
        fail++
      }

      const adapterPkg = ADAPTER_PACKAGES[fw.name]
      if (adapterPkg) {
        if (isPackageInstalled(fw.projectDir, adapterPkg)) {
          log.success(`${adapterPkg} installed ${pc.dim(`(${relPath(opts.cwd, fw.projectDir) || '.'})`)}`)
          pass++
        } else {
          log.error(`${adapterPkg} NOT installed in ${pc.dim(relPath(opts.cwd, fw.projectDir) || '.')} — run ${pc.cyan(`npm i -D ${adapterPkg}`)}`)
          fail++
        }
      }
      if (!isPackageInstalled(fw.projectDir, GATEWAY_PKG)) {
        log.warn(`${GATEWAY_PKG} not in ${relPath(opts.cwd, fw.projectDir) || '.'} package.json (OK if you use ${pc.cyan('npx web-dev-mcp')} — won't auto-spawn from the adapter)`)
        warn++
      }
    }
  }

  // 3. MCP client configs — check for ANY entry pointing at our gateway URL
  // (user may have registered under a custom key like 'my-mcp' instead of 'web-dev-mcp')
  const gatewayUrl = `http://localhost:${opts.port}/__mcp/sse`
  const mcpRels: Array<{ path: string; serversKey: string }> = [
    { path: '.mcp.json', serversKey: 'mcpServers' },
    { path: '.cursor/mcp.json', serversKey: 'mcpServers' },
    { path: '.windsurf/mcp.json', serversKey: 'mcpServers' },
    { path: '.vscode/mcp.json', serversKey: 'servers' },
  ]
  let anyMcpFound = false
  let anyMcpPointsHere = false
  for (const { path, serversKey } of mcpRels) {
    const full = join(opts.cwd, path)
    if (!existsSync(full)) continue
    anyMcpFound = true
    try {
      const config = JSON.parse(readFileSync(full, 'utf-8'))
      const servers = (config[serversKey] ?? {}) as Record<string, { url?: string }>
      const matchingEntry = Object.entries(servers).find(([_k, v]) => v?.url === gatewayUrl)
      if (matchingEntry) {
        const [key] = matchingEntry
        const keyHint = key === 'web-dev-mcp' ? '' : pc.dim(` (key: ${key})`)
        log.success(`MCP registered in ${pc.dim(path)}${keyHint}`)
        pass++
        anyMcpPointsHere = true
      } else {
        log.warn(`${path} exists but no entry points to ${pc.dim(gatewayUrl)}`)
        warn++
      }
    } catch (err) {
      log.warn(`Could not parse ${pc.dim(path)} — ${(err as Error).message}`)
      warn++
    }
  }
  if (!anyMcpFound) {
    log.warn(`No MCP client config files found. Run ${pc.cyan('npx web-dev-mcp register')} to create them.`)
    warn++
  } else if (!anyMcpPointsHere) {
    log.error(`MCP files exist but none point to ${pc.dim(gatewayUrl)}. Run ${pc.cyan('npx web-dev-mcp register')}.`)
    fail++
  }

  // Summary
  const summary = [
    `${pc.green(`✓ ${pass} passed`)}`,
    warn > 0 ? `${pc.yellow(`▲ ${warn} warning${warn !== 1 ? 's' : ''}`)}` : null,
    fail > 0 ? `${pc.red(`✗ ${fail} failed`)}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ')
  note(summary, 'doctor')

  if (fail > 0) {
    outro(pc.red('Some checks failed.'))
    process.exitCode = 1
  } else if (warn > 0) {
    outro(pc.yellow('All required checks passed (warnings noted).'))
  } else {
    outro(pc.green('All checks passed.'))
  }
}

async function checkGatewayReachable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: 'localhost', port, path: '/', method: 'HEAD', timeout: 1500 },
      (res) => {
        // Any HTTP response means the gateway is up.
        res.resume()
        resolve(true)
      }
    )
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.end()
  })
}

function isPackageInstalled(projectDir: string, pkg: string): boolean {
  // Cheap check: package dir in node_modules. Workspace-hoisted deps may live
  // in a parent node_modules — walk up until found or filesystem root.
  let dir = projectDir
  while (true) {
    if (existsSync(join(dir, 'node_modules', pkg, 'package.json'))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}
