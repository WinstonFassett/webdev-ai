# Getting Started with web-dev-mcp

web-dev-mcp gives AI agents live browser access during development — console logs, DOM queries, screenshots, form filling, navigation.

## Easy mode

In your project directory:

```bash
npx web-dev-mcp init
```

This detects your framework (Vite / Next.js / Astro / Storybook), wires the adapter, installs the dev dependencies, and registers the MCP server with Claude / Cursor / Windsurf / VS Code in one shot.

Then `npm run dev` and connect your agent. Skip the rest of this doc unless something doesn't work or you want to do it manually.

---

## Manual setup

There are **4 things to set up**, and they're all independent:

| Step | What | Why |
|------|------|-----|
| 1 | [Install the gateway](#1-install-the-gateway) | The hub that connects agents to browsers |
| 2 | [Hook into your dev app](#2-hook-into-your-dev-app) | Injects the browser client into your pages |
| 3 | [Add the MCP server to your agent](#3-add-the-mcp-server-to-your-agent) | Gives the agent browser tools |
| 4 | [Add the skill (Claude Code)](#4-add-the-skill-claude-code-only) | Teaches the agent *how* to use the tools |

---

## 1. Install the gateway

The gateway is a lightweight local server (`:3333`) that routes between agents and browsers.

**Global install** (recommended — use across all projects):

```bash
npm install -g @winstonfassett/web-dev-mcp-gateway
```

Then start it with:

```bash
web-dev-mcp
```

**Or run without installing:**

```bash
npx @winstonfassett/web-dev-mcp-gateway
```

> The gateway must be running for everything else to work. Framework adapters (step 2) auto-start it, so you often don't need a separate terminal.

---

## 2. Hook into your dev app

The gateway needs a client script injected into your pages. Pick your framework:

### Vite

```bash
npm install -D @winstonfassett/web-dev-mcp-vite @winstonfassett/web-dev-mcp-gateway
```

```ts
// vite.config.ts
import { webDevMcp } from '@winstonfassett/web-dev-mcp-vite'

export default defineConfig({
  plugins: [webDevMcp()],
})
```

### Storybook (Vite-based)

```bash
npm install -D @winstonfassett/web-dev-mcp-vite @winstonfassett/web-dev-mcp-gateway
```

```ts
// .storybook/main.ts
export default {
  addons: ['@winstonfassett/web-dev-mcp-vite/storybook'],
}
```

### Astro

```bash
npm install -D @winstonfassett/web-dev-mcp-astro @winstonfassett/web-dev-mcp-gateway
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import webDevMcp from '@winstonfassett/web-dev-mcp-astro'

export default defineConfig({
  integrations: [webDevMcp()],
})
```

### Next.js (Webpack)

```bash
npm install -D @winstonfassett/web-dev-mcp-nextjs @winstonfassett/web-dev-mcp-gateway
```

```js
// next.config.js
import { withWebDevMcp } from '@winstonfassett/web-dev-mcp-nextjs'
export default withWebDevMcp({ /* your config */ })
```

That's it — client injection happens via webpack entry.

### Next.js (Turbopack)

Same install and config wrapper as above, plus one extra step — Turbopack can't inject via webpack entry, so add the init component to your layout:

```tsx
// app/layout.tsx
import { WebDevMcpInit } from '@winstonfassett/web-dev-mcp-nextjs/init'

export default function RootLayout({ children }) {
  return (
    <html><body>
      <WebDevMcpInit />
      {children}
    </body></html>
  )
}
```

### Any dev server (manual)

No adapter needed. For frameworks without a dedicated adapter (Remix, SvelteKit standalone, Nuxt, SolidStart, Qwik, plain Express, etc.) use one of:

- **Proxy mode** (zero edits to your app): browse `http://localhost:3333/http://localhost:YOUR_PORT/` — the gateway proxies and instruments any URL automatically. Best for quick experiments and frameworks the `init` command doesn't recognize.
- **Script tag** (one line in your HTML): add `<script src="http://localhost:3333/__web-dev-mcp.js"></script>` to your `<head>`. Works with any HTML rendering (SSR, SSG, plain Express).

> All adapters auto-start the gateway. If you installed globally, the adapter finds it. No separate terminal needed.

---

## 3. Add the MCP server to your agent

The MCP server is an SSE endpoint on the gateway. You need to register it with each AI agent/IDE that should have browser access.

### Auto-register (all agents at once)

```bash
npx @winstonfassett/web-dev-mcp-gateway --auto-register
```

This writes the MCP config into all four locations:
- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)
- `.windsurf/mcp.json` (Windsurf)
- `.vscode/mcp.json` (VS Code / Copilot)

### Manual registration

Add to the appropriate config file for your agent:

<details><summary>Claude Code — <code>.mcp.json</code> (project root)</summary>

```json
{
  "mcpServers": {
    "web-dev-mcp": {
      "type": "sse",
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```
</details>

<details><summary>Cursor — <code>.cursor/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "web-dev-mcp": {
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```
</details>

<details><summary>Windsurf — <code>.windsurf/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "web-dev-mcp": {
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```
</details>

<details><summary>VS Code (Copilot) — <code>.vscode/mcp.json</code></summary>

```json
{
  "servers": {
    "web-dev-mcp": {
      "type": "sse",
      "url": "http://localhost:3333/__mcp/sse"
    }
  }
}
```

> Note: VS Code uses `"servers"` not `"mcpServers"`.
</details>

---

## 4. Add the skill (Claude Code only)

Skills teach Claude Code *how* to use the MCP tools effectively — workflows, gotchas, best practices.

```bash
npx skills add WinstonFassett/web-dev-mcp --all
```

The `--all` flag installs all skills to all detected agents (Claude Code, Cursor, Windsurf, etc.) in one shot. To target specific agents:

```bash
npx skills add WinstonFassett/web-dev-mcp --agent claude-code cursor
```

This installs the `web-dev-mcp` skill which covers:
- When to call `set_project` and `get_diagnostics`
- How to use `eval_js` with `browser.*` helpers
- Test-fix loop patterns, screenshot workflows, DOM navigation

> Skills are primarily useful for agents that support SKILL.md files (Claude Code, etc.). Other agents still benefit from the MCP tools alone (step 3).

---

## Verify it works

1. Start your dev app (`npm run dev`)
2. Open it in a browser
3. In your agent, run:
   ```
   get_diagnostics
   ```
   You should see console logs, connected browsers, and build status.

---

## Quick reference

| What | Command / Location |
|------|-------------------|
| Start gateway | `web-dev-mcp` or `npx @winstonfassett/web-dev-mcp-gateway` |
| Gateway port | `:3333` (change with `-p`) |
| MCP endpoint | `http://localhost:3333/__mcp/sse` |
| Full toolset (23 tools) | `http://localhost:3333/__mcp/sse?tools=full` |
| Admin UI | `http://localhost:3333` |
| Auto-register MCP | `npx @winstonfassett/web-dev-mcp-gateway --auto-register` |
| Network capture | `web-dev-mcp --network` |

## Compatibility

What's been verified end-to-end (strip → init → dev server → agent calls a tool → result flows back):

| Framework | Verified | Notes |
|---|---|---|
| Vite | ✓ | reference framework |
| Astro | ✓ | via `@winstonfassett/web-dev-mcp-astro` |
| Next.js (Webpack) | ~ | byte-perfect wiring; runtime smoke deferred |
| Next.js (Turbopack) | ~ | byte-perfect wiring; runtime smoke deferred |
| Storybook (Vite) | ~ | byte-perfect wiring; runtime smoke deferred |
| TanStack Start | ~ | wires via Vite adapter; verified in fixture |
| SvelteKit (dev) | ~ | wires via Vite adapter; not directly tested |
| Remix / Nuxt / SolidStart / Qwik | use proxy mode | no dedicated adapter — use proxy or script-tag |

Node ≥ 20.6 (gateway). Tested agents: Claude Code, Cursor (MCP); VS Code Copilot uses `"servers"` not `"mcpServers"` (handled by `init`).

---

## Troubleshooting

**No browsers connected**: Make sure your dev app is open in a browser *after* the gateway is running. Check the browser console for connection errors.

**"Did it work?"**: Run `npx web-dev-mcp doctor` after `init` + starting your dev server. Reports gateway reachability, framework wiring, adapter install, and MCP registration.

**Gateway not starting** (port in use): The gateway prints the offending PID — `Held by: PID 12345 (node). Either stop that process, or run with a different port: npx web-dev-mcp -p <other-port>`. To investigate manually: `lsof -i :3333` (macOS/Linux) or `netstat -ano | findstr :3333` (Windows).

**MCP tools not appearing in agent**: Restart the agent after adding `.mcp.json`. Some agents require a reload to pick up new MCP servers.

**Turbopack: no logs appearing**: Did you add `<WebDevMcpInit />` to your layout? Turbopack requires the explicit component — the config wrapper alone isn't enough. `npx web-dev-mcp doctor` will flag this.

**HMR / build events not capturing**: The adapter forwards HMR via the gateway helper. If you wired the config manually but skipped the helper import, build events won't reach the gateway. Easiest fix: re-run `npx web-dev-mcp init` (idempotent — won't duplicate wiring).

### CSP-strict apps (script blocked)

If your app sets a strict Content-Security-Policy, the browser will block the injected client. Symptom: no MCP tools work, devtools console shows a CSP violation referencing `http://localhost:3333`.

Add to your dev-only CSP:

```
script-src  'self' http://localhost:3333;
connect-src 'self' http://localhost:3333 ws://localhost:3333;
```

Or use **proxy mode** (`http://localhost:3333/http://localhost:YOUR_PORT/`) — the gateway serves the page same-origin, so the script is never cross-origin and CSP doesn't fire.

### HTTPS dev servers (mixed-content block)

If your dev server uses HTTPS (e.g. `vite --https`, webpack-dev-server with HTTPS), the page origin is `https://`. The injected script's `http://localhost:3333` URL is mixed-content and will be blocked.

Three options:

1. **Run the gateway with HTTPS too** — `npx web-dev-mcp --https` (self-signed). Trust the cert in your browser, then the page can reach `https://localhost:3333`.
2. **Use a tunnel** like `cloudflared` or `ngrok` that gives you `wss://` for the gateway URL.
3. **Drop HTTPS in dev** — usually the simplest path; HTTPS-only behaviors (e.g. service workers) are out of scope for this tool.

### Devcontainers / Codespaces / Docker

The page runs in your host browser; the gateway needs to be reachable from the same network as both the page and the agent. Two configurations work:

**Gateway inside the container** (recommended for Codespaces): run the gateway alongside your dev server. VS Code's auto port forwarding will surface `:3333` as `localhost:3333` to your host browser.

```jsonc
// .devcontainer/devcontainer.json
{
  "forwardPorts": [3333, 5173]   // gateway + your dev server
}
```

**Gateway on the host, dev server in the container**: page reaches `localhost:3333` (host) directly. The container needs to reach the host gateway too — use `host.docker.internal:3333` from within the container if any code there talks back to the gateway.

> If the agent is also remote (Claude Code in a tunnel, etc.), point its MCP config at the publicly-reachable URL — not `localhost`.
