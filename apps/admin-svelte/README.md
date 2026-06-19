# admin-svelte

Admin UI for the webdev gateway. Not a standalone app, not published to npm.

Served at `/__admin` when the gateway is running (`@winstonfassett/webdev-gateway`).

## What it shows

- Connected browsers and their status
- MCP tool call logs with screenshots
- Multi-project log view with sticky headers

## Stack

- Svelte 5, TypeScript
- Tailwind v4 (via `@tailwindcss/vite`)
- Vite dev server on port 5174
- CodeMirror for code display

## Developing

Start the gateway first (must be running for SSE/WS to work):

```bash
# from monorepo root
npm run gateway:start
```

Then run the dev server:

```bash
cd apps/admin-svelte
npm run dev
# opens at http://localhost:5174
```

The `webdev()` Vite plugin auto-connects to the running gateway (default port 3333), so the dev server proxies gateway APIs. `base` is `/` in dev and `/__admin/` in production.

## Build

Built as part of `npm run gateway:build` at the monorepo root:

```bash
npm --prefix apps/admin-svelte run build
```

Output goes to `apps/gateway/dist/admin/` and is served statically by the gateway at `/__admin`.
