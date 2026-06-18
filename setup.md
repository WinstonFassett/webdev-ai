# Setup

webdev gives AI agents live browser access during development — console logs, DOM queries, screenshots, form filling, navigation.

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
npm install -g @winstonfassett/webdev-gateway
```

Then start it with:

```bash
webdev
```

**Or run without installing:**

```bash
npx @winstonfassett/webdev-gateway
```

> The gateway must be running for everything else to work. Framework adapters (step 2) auto-start it, so you often don't need a separate terminal.

---

## 2. Hook into your dev app

The gateway needs a client script injected into your pages. Pick your framework:

### Vite

```bash
npm install -D @winstonfassett/webdev-vite @winstonfassett/webdev-gateway
```

```ts
// vite.config.ts
import { webdev } from '@winstonfassett/webdev-vite'

export default defineConfig({
  plugins: [webdev()],
})
```

If [`@vitejs/devtools`](https://devtools.vite.dev/) is also installed, the adapter auto-registers a `webdev-ai` panel and an element-picker action in the DevTools dock — just add `DevTools()` alongside `webdev()` in the plugins list. Optional peer; no runtime cost when not installed.

### Storybook (Vite-based)

```bash
npm install -D @winstonfassett/webdev-vite @winstonfassett/webdev-gateway
```

```ts
// .storybook/main.ts
export default {
  addons: ['@winstonfassett/webdev-vite/storybook'],
}
```

### Astro

```bash
npm install -D @winstonfassett/webdev-astro @winstonfassett/webdev-gateway
```

```js
// astro.config.mjs
import { defineConfig } from 'astro/config'
import webdev from '@winstonfassett/webdev-astro'

export default defineConfig({
  integrations: [webdev()],
})
```

### Next.js (Webpack)

```bash
npm install -D @winstonfassett/webdev-nextjs @winstonfassett/webdev-gateway
```

```js
// next.config.js
import { withWebdev } from '@winstonfassett/webdev-nextjs'
export default withWebdev({ /* your config */ })
```

That's it — client injection happens via webpack entry.

### Next.js (Turbopack)

Same install and config wrapper as above, plus one extra step — Turbopack can't inject via webpack entry, so add the init component to your layout:

```tsx
// app/layout.tsx
import { WebdevInit } from '@winstonfassett/webdev-nextjs/init'

export default function RootLayout({ children }) {
  return (
    <html><body>
      <WebdevInit />
      {children}
    </body></html>
  )
}
```

### Any dev server (manual)

No adapter needed. For frameworks without a dedicated adapter (Remix, SvelteKit standalone, Nuxt, SolidStart, Qwik, plain Express, etc.) use one of:

- **Proxy mode** (zero edits to your app): browse `http://localhost:3333/http://localhost:YOUR_PORT/` — the gateway proxies and instruments any URL automatically. Best for quick experiments and frameworks the `init` command doesn't recognize.
- **Script tag** (one line in your HTML): add `<script src="http://localhost:3333/__webdev.js"></script>` to your `<head>`. Works with any HTML rendering (SSR, SSG, plain Express).

> All adapters auto-start the gateway. If you installed globally, the adapter finds it. No separate terminal needed.

---

## 3. Add the MCP server to your agent

The MCP server is an SSE endpoint on the gateway. You need to register it with each AI agent/IDE that should have browser access.

### Global registration (recommended — do this once)

```bash
npx @winstonfassett/webdev-gateway register --global
```

Detects which agents are installed and asks which ones to register with. Works across all your projects — no per-project setup needed.

To skip the prompt:

```bash
npx @winstonfassett/webdev-gateway register --global --agents claude
npx @winstonfassett/webdev-gateway register --global --agents claude,cursor
```

Supported agent IDs: `claude`, `cursor`, `windsurf`.

### Project-level registration

If you prefer per-project MCP config (checked into the repo):

```bash
npx @winstonfassett/webdev-gateway register
```

Writes `.mcp.json`, `.cursor/mcp.json`, `.windsurf/mcp.json`, and `.vscode/mcp.json` in the current directory.

### Manual registration

Add to the appropriate config file for your agent:

<details><summary>Claude Code — <code>.mcp.json</code> (project root)</summary>

```json
{
  "mcpServers": {
    "webdev": {
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
    "webdev": {
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
    "webdev": {
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
    "webdev": {
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
npx skills add WinstonFassett/webdev --all
```

The `--all` flag installs all skills to all detected agents (Claude Code, Cursor, Windsurf, etc.) in one shot. To target specific agents:

```bash
npx skills add WinstonFassett/webdev --agent claude-code cursor
```

This installs the `webdev` skill which covers:
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
| Start gateway | `webdev` or `npx @winstonfassett/webdev-gateway` |
| Gateway port | `:3333` (change with `-p`) |
| MCP endpoint | `http://localhost:3333/__mcp/sse` |
| Full toolset (23 tools) | `http://localhost:3333/__mcp/sse?tools=full` |
| Admin UI | `http://localhost:3333` |
| Register MCP globally | `npx @winstonfassett/webdev-gateway register --global` |
| Network capture | `webdev --network` |

## Compatibility

What's been verified end-to-end (strip → init → dev server → agent calls a tool → result flows back):

| Framework | Verified | Notes |
|---|---|---|
| Vite | ✓ | reference framework |
| Astro | ✓ | via `@winstonfassett/webdev-astro` |
| Next.js (Webpack) | ~ | byte-perfect wiring; runtime smoke deferred |
| Next.js (Turbopack) | ~ | byte-perfect wiring; runtime smoke deferred |
| Storybook (Vite) | ~ | byte-perfect wiring; runtime smoke deferred |
| TanStack Start | ~ | wires via Vite adapter; verified in fixture |
| SvelteKit (dev) | ~ | wires via Vite adapter; not directly tested |
| Remix / Nuxt / SolidStart / Qwik | use proxy mode | no dedicated adapter — use proxy or script-tag |

Node ≥ 20.6 (gateway). Tested agents: Claude Code, Cursor (MCP); VS Code Copilot uses `"servers"` not `"mcpServers"` (handled by `init`).

---

## Troubleshooting

See [troubleshooting.md](troubleshooting.md) for the full troubleshooting guide.
