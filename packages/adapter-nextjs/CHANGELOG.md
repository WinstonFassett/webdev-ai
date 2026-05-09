# Changelog

## 0.1.0 (unreleased)

First stable release after the `0.1.0-alpha.0` line.

- Wired by `npx webdev init` (wraps `next.config.{js,ts,mjs}` with `withWebdev()` and, for Next.js Turbopack, injects `<WebDevMcpInit />` into `app/layout.tsx`).
- Bundler detection: `--webpack` / `--turbopack` flags, then Next.js major version (>=16 → turbopack, <16 → webpack).

## 0.1.0-alpha.0

Initial alpha. Next.js adapter for webdev — `withWebdev` HOF, webpack entry injection, instrumentation hooks.
