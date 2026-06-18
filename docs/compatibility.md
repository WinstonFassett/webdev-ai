# Compatibility

Node ≥ 20.6 (gateway). Tested agents: Claude Code, Cursor, VS Code Copilot.

## Frameworks

| Framework | Status | Notes |
|---|---|---|
| Vite | ✓ | reference framework |
| Astro | ✓ | via `@winstonfassett/webdev-astro` |
| Next.js (Webpack) | ~ | byte-perfect wiring; runtime smoke deferred |
| Next.js (Turbopack) | ~ | byte-perfect wiring; runtime smoke deferred |
| Storybook (Vite) | ~ | byte-perfect wiring; runtime smoke deferred |
| TanStack Start | ~ | wires via Vite adapter; verified in fixture |
| SvelteKit (dev) | ~ | wires via Vite adapter; not directly tested |
| Remix / Nuxt / SolidStart / Qwik | proxy mode | no dedicated adapter — use proxy or script tag |
