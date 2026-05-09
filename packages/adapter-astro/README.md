# @winstonfassett/webdev-astro

Astro integration for [webdev](https://github.com/WinstonFassett/webdev) — live browser observability for AI agents during development.

## Install

```bash
npm install -D @winstonfassett/webdev-astro @winstonfassett/webdev-gateway
```

Or, in one step:

```bash
npx webdev init
```

## Astro

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config'
import webdev from '@winstonfassett/webdev-astro'

export default defineConfig({
  integrations: [webdev()],
})
```

Gateway auto-starts. No separate terminal needed.

MCP endpoint: `http://localhost:3333/__mcp/sse`

## License

MIT
