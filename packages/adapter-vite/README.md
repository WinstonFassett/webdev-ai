# @winstonfassett/webdev-vite

Vite plugin for [webdev-mcp](https://github.com/WinstonFassett/webdev-mcp) — live browser observability for AI agents during development.

## Install

```bash
npm install -D @winstonfassett/webdev-vite @winstonfassett/webdev-gateway
```

## Vite

```ts
// vite.config.ts
import { webDevMcp } from '@winstonfassett/webdev-vite'

export default defineConfig({
  plugins: [webDevMcp()],
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

## Options

```ts
webDevMcp({
  gateway: 'http://localhost:3333',  // Gateway URL (default)
  serverType: 'vite',                // 'vite' | 'storybook' | 'generic'
})
```

## License

MIT
