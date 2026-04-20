#!/usr/bin/env node

import { Command } from 'commander'
import { startGateway } from './gateway.js'
import { runInit } from './installer.js'

const program = new Command()

program
  .name('web-dev-mcp')
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
  .description('Install web-dev-mcp into the current project (detect framework, wire config, install deps, register MCP)')
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
  .command('register')
  .description('Register MCP URL with agent clients (.mcp.json, .cursor/, .windsurf/, .vscode/)')
  .option('-p, --port <port>', 'Gateway port', (v) => parseInt(v, 10), 3333)
  .option('--global', 'Write to user-level configs (~/.claude/, ~/.cursor/) instead of project-level')
  .action(async (opts) => {
    const { autoRegister, autoRegisterGlobal } = await import('./auto-register.js')
    const mcpUrl = `http://localhost:${opts.port}/__mcp/sse`
    if (opts.global) {
      const registered = autoRegisterGlobal(mcpUrl)
      for (const path of registered) console.log(`  Registered (global): ${path}`)
    } else {
      const registered = autoRegister(process.cwd(), mcpUrl)
      for (const path of registered) console.log(`  Registered: ${path}`)
    }
  })

program.parseAsync().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
