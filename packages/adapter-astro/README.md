# @winstonfassett/webdev-astro

Astro integration for [web-dev-mcp](https://github.com/WinstonFassett/web-dev-mcp) — live browser observability for AI agents during development.

## Install

```bash
npm install -D @winstonfassett/webdev-astro @winstonfassett/webdev-gateway
```

Or, in one step:

```bash
npx web-dev-mcp init
```

## Astro

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config'
import webDevMcp from '@winstonfassett/webdev-astro'

export default defineConfig({
  integrations: [webDevMcp()],
})
```

Gateway auto-starts. No separate terminal needed.

MCP endpoint: `http://localhost:3333/__mcp/sse`

## License

MIT
