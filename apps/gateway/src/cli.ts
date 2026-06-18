#!/usr/bin/env node

import { Command } from 'commander'
import { startGateway } from './gateway.js'
import { runInit } from './installer.js'
import { runDoctor } from './doctor.js'

const program = new Command()

program
  .name('npx webdev')
  .description('MCP gateway for web development — proxy any dev server with live browser observability for AI agents')

program
  .command('start', { isDefault: true })
  .description('Start the gateway (default command)')
  .option('-p, --port <port>', 'Gateway port', (v) => parseInt(v, 10))
  .option('--network', 'Capture fetch/XHR requests')
  .option('--https', 'Enable HTTPS with self-signed cert')
  .option('--cert <path>', 'Custom TLS certificate (use with --key)')
  .option('--key <path>', 'Custom TLS private key (use with --cert)')
  .option('--auto-register', 'Register MCP URL in .mcp.json, .cursor/, .windsurf/ then exit')
  .option('--global', 'With --auto-register: write to user-level configs (~/.claude/, ~/.cursor/)')
  .action(async (opts) => {
    if (opts.autoRegister) {
      const { autoRegister, autoRegisterGlobal } = await import('./auto-register.js')
      const port = opts.port ?? 3333
      const mcpUrl = `http://localhost:${port}/__mcp/sse`

      if (opts.global) {
        const registered = autoRegisterGlobal(mcpUrl)
        for (const path of registered) {
          console.log(`  Auto-registered (global): ${path}`)
        }
      } else {
        const registered = autoRegister(process.cwd(), mcpUrl)
        for (const path of registered) {
          console.log(`  Auto-registered: ${path}`)
        }
      }
      process.exit(0)
    }

    await startGateway({
      port: opts.port,
      network: opts.network,
      https: opts.https,
      cert: opts.cert,
      key: opts.key,
    })
  })

program
  .command('init')
  .description('Install webdev into the current project (detect framework, wire config, install deps, register MCP)')
  .option('--cwd <dir>', 'Project directory (default: current)', process.cwd())
  .option('-p, --port <port>', 'Gateway port to register with MCP clients (default: 3333)', (v) => parseInt(v, 10), 3333)
  .option('--skip-install', 'Skip npm install of adapter + gateway packages')
  .option('--skip-mcp', 'Skip writing MCP client config files')
  .option('-y, --yes', 'Auto-accept all prompts (non-interactive / CI)')
  .action(async (opts) => {
    await runInit({
      cwd: opts.cwd,
      port: opts.port,
      skipInstall: opts.skipInstall,
      skipMcp: opts.skipMcp,
      yes: opts.yes,
    })
  })

program
  .command('doctor')
  .description('Verify setup: gateway reachable, framework wired, adapter installed, MCP registered')
  .option('--cwd <dir>', 'Project directory (default: current)', process.cwd())
  .option('-p, --port <port>', 'Gateway port (default: 3333)', (v) => parseInt(v, 10), 3333)
  .action(async (opts) => {
    await runDoctor({ cwd: opts.cwd, port: opts.port })
  })

program
  .command('register')
  .description('Register MCP URL with agent clients (.mcp.json, .cursor/, .windsurf/, .vscode/)')
  .option('-p, --port <port>', 'Gateway port', (v) => parseInt(v, 10), 3333)
  .option('--global', 'Register globally (user-level) instead of project-level')
  .option('--agents <agents>', 'Comma-separated agents to register: claude,cursor,windsurf (skips prompt)')
  .action(async (opts) => {
    const autoRegisterMod = await import('./auto-register.js')
    const { autoRegister, detectInstalledAgents, registerGlobalAgents, GLOBAL_AGENTS } = autoRegisterMod
    const mcpUrl = `http://localhost:${opts.port}/__mcp/sse`

    if (opts.global) {
      const installed = detectInstalledAgents()

      if (installed.length === 0) {
        console.log('No supported agents detected (~/.claude, ~/.cursor, ~/.windsurf).')
        process.exit(0)
      }

      let chosen: string[]

      if (opts.agents) {
        const requested = opts.agents.split(',').map((s: string) => s.trim())
        const unknown = requested.filter((a: string) => !['claude', 'cursor', 'windsurf'].includes(a))
        if (unknown.length) {
          console.error(`Unknown agents: ${unknown.join(', ')}. Valid: claude, cursor, windsurf`)
          process.exit(1)
        }
        chosen = requested
      } else {
        // Interactive prompt
        const { createInterface } = await import('node:readline')
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        const question = (q: string) => new Promise<string>(res => rl.question(q, res))

        console.log('\nDetected agents:')
        for (let i = 0; i < installed.length; i++) {
          console.log(`  ${i + 1}. ${GLOBAL_AGENTS[installed[i]].label} (${installed[i]})`)
        }
        console.log(`  a. All of the above`)
        console.log()

        const answer = await question('Which agents to register with? (numbers, comma-separated, or "a"): ')
        rl.close()

        if (answer.trim().toLowerCase() === 'a') {
          chosen = installed
        } else {
          const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1)
          chosen = indices
            .filter(i => i >= 0 && i < installed.length)
            .map(i => installed[i])
          if (chosen.length === 0) {
            console.log('No valid selection. Exiting.')
            process.exit(0)
          }
        }
      }

      console.log()
      const results = registerGlobalAgents(chosen, mcpUrl)
      for (const r of results) {
        if (r.ok) {
          console.log(`  ✓ ${r.label} — ${r.path}`)
        } else {
          console.log(`  ✗ ${r.label} — ${r.error ?? 'failed'}`)
        }
      }
    } else {
      const registered = autoRegister(process.cwd(), mcpUrl)
      for (const path of registered) console.log(`  Registered: ${path}`)
    }
  })

program.parseAsync().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
