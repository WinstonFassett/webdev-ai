# Changelog

## 0.1.0 (unreleased)

First stable release after the `0.1.0-alpha.0` line.

- `npx web-dev-mcp init` — one-command installer that detects framework, wires config, installs adapters, and registers MCP clients (`.mcp.json`, `.cursor/`, `.windsurf/`, `.vscode/`).
- `npx web-dev-mcp register` — standalone MCP registration subcommand.
- Server-side log clear, SPA fallback, and server lifecycle events.
- Scope-aware `clearLogs` with per-browser checkpoints.
- Admin UI improvements: persistent log clears, multi-select channel picker, sticky source header, dark-mode toggle, REPL with command history.
- Build status `--turbopack`-aware.

## 0.1.0-alpha.0

Initial alpha. MCP gateway core: SSE endpoint, RPC server, log writers, dynamic proxy, CDP relay for the Chrome extension.
