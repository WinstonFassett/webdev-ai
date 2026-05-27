# @winstonfassett/webdev-vite

Vite plugin for [webdev](https://github.com/WinstonFassett/webdev) — live browser observability for AI agents during development.

## Install

```bash
npm install -D @winstonfassett/webdev-vite @winstonfassett/webdev-gateway
```

## Vite

```ts
// vite.config.ts
import { webdev } from '@winstonfassett/webdev-vite'

export default defineConfig({
  plugins: [webdev()],
})
```

Gateway auto-starts. No separate terminal needed.

MCP endpoint: `http://localhost:3333/__mcp/sse`

## Storybook

```ts
// .storybook/main.ts
export default {
  addons: ['@winstonfassett/webdev-vite/storybook'],
}
```

## Vite DevTools dock

If [`@vitejs/devtools`](https://devtools.vite.dev/) is installed in the host app, this plugin auto-registers a `webdev-ai` panel in the DevTools dock that iframes the gateway admin UI scoped to the current Vite server. No config needed:

```ts
// vite.config.ts
import { DevTools } from '@vitejs/devtools'
import { webdev } from '@winstonfassett/webdev-vite'

export default defineConfig({
  plugins: [DevTools(), webdev()],
})
```

`@vitejs/devtools` is an opt-in peer dep. If not installed, the `devtools.setup` hook is never called — zero runtime cost.

## Options

```ts
webdev({
  gateway: 'http://localhost:3333',  // Gateway URL (default)
  serverType: 'vite',                // 'vite' | 'storybook' | 'generic'
})
```

## License

MIT
