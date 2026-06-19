# Changelog

## 0.1.0 (2026-06-19)

### Features

- **MCP gateway** — standalone daemon (`npx webdev`) serving 6 core tools (screenshot, click, eval_js, query_dom, navigate, get_logs) plus 23 full tools; auto-starts on first adapter use
- **Vite adapter** (`@winstonfassett/webdev-vite`) — Vite plugin that connects dev servers to the gateway; includes Vite DevTools dock panel integration
- **Next.js adapter** (`@winstonfassett/webdev-nextjs`) — Next.js plugin with Webpack and Turbopack support
- **Chrome extension** (`apps/extension`) — auto-attaches Chrome DevTools Protocol for pixel-perfect screenshots and reliable locators via Playwright API
- **CDP relay** — connects Playwright to existing browser sessions via `connectOverCDP`; endpoints at `/devtools/browser/*` and `/json/version`
- **`eval_js`** — runs JS directly in the browser with `document`/`window` access; accepts `string | string[]` (array = auto-waited pipeline); includes `browser.*` helpers and persistent `state` object
- **`register --global`** — interactive CLI to register the gateway as an MCP server in Claude, Cursor, or other agents; auto-detects installed agents
- **Portless integration** — uses stable `.localhost` URLs instead of port numbers for dev server discovery
- **Admin UI** — Svelte-based admin panel bundled into the gateway at `/__admin`; shows connected browsers, logs, and tool history
- **Multi-project support** — gateway manages multiple dev servers; logs view with sticky project headers

### Fixes

- Report accurate config path for `claude` global register
- Exclude `.webdev/` from Vite file watcher to prevent HMR reload loop
- Peer dep constraints in adapters updated to `>=0.1.0-alpha.0`

### Packages

| Package | Version |
|---|---|
| `@winstonfassett/webdev-gateway` | `0.1.0` |
| `@winstonfassett/webdev-vite` | `0.1.0` |
| `@winstonfassett/webdev-nextjs` | `0.1.0` |
