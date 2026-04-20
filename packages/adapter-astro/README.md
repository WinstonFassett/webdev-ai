# @winstonfassett/web-dev-mcp-astro

Astro integration for [web-dev-mcp](https://github.com/WinstonFassett/web-dev-mcp) — live browser observability for AI agents during development.

## Install

```bash
npm install -D @winstonfassett/web-dev-mcp-astro @winstonfassett/web-dev-mcp-gateway
```

Or, in one step:

```bash
npx web-dev-mcp init
```

## Astro

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config'
import webDevMcp from '@winstonfassett/web-dev-mcp-astro'

export default defineConfig({
  integrations: [webDevMcp()],
})
```

Gateway auto-starts. No separate terminal needed.

MCP endpoint: `http://localhost:3333/__mcp/sse`

## License

MIT
