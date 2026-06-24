---
name: webdev-storybook
description: Storybook-specific patterns for webdev. Use when working with Storybook components — navigating stories, TDD per-component, visual testing across variants, interacting with rendered components in the preview iframe.
---

# webdev-storybook

Extends webdev with Storybook-specific workflows. Requires the `webdev` skill for core tools (`eval_js`, `get_diagnostics`, `clear`, etc.).

## Detecting Storybook

When `list_projects` returns a server with `type: "storybook"`, these patterns apply. The MCP tools operate on the **preview iframe** (`/iframe.html`), not the Storybook manager shell.

## Storybook globals (via browser.eval)

Storybook injects useful globals into the preview iframe, accessible via `browser.eval`:

| Global | What it gives you |
|--------|-------------------|
| `__STORYBOOK_PREVIEW__.storyStoreValue.storyIndex.entries` | All stories: IDs, names, titles, file paths |
| `__STORYBOOK_PREVIEW__.currentSelection` | Current story ID and viewMode |
| `__STORYBOOK_ADDONS_CHANNEL__` | Channel for SPA-style story navigation (no RPC disconnect) |

**List all stories:**
```js
return await browser.eval(
  "JSON.stringify(Object.values(window.__STORYBOOK_PREVIEW__.storyStoreValue.storyIndex.entries).map(e => ({id: e.id, name: e.name, title: e.title, file: e.componentPath})))"
)
// → [{id: "components-button--primary", name: "Primary", title: "Components/Button", file: "./src/Button.tsx"}, ...]
```

**Get current story:**
```js
return await browser.eval("JSON.stringify(window.__STORYBOOK_PREVIEW__.currentSelection)")
// → {viewMode: "story", storyId: "components-button--primary"}
```

## Navigate to a story

Use the Storybook channel to navigate — it's SPA-style, RPC stays connected, no wait needed:

```js
await browser.eval("window.__STORYBOOK_ADDONS_CHANNEL__.emit('setCurrentStory', { storyId: 'components-button--danger' })")
await new Promise(r => setTimeout(r, 200))
return await browser.markdown()
```

URL-based navigation (`browser.navigate` to `iframe.html?id=...`) does **not** change the story — the manager frame controls story selection, not the iframe URL.

## Story URL pattern

Story IDs are derived from title/name, lowercased and kebab-cased:
- `Components / Button` + story `Primary` → `components-button--primary`
- `Forms / Input` + story `With Validation` → `forms-input--with-validation`

## TDD in Storybook

```
clear
# edit component source — HMR reloads the story automatically
get_diagnostics({ since_checkpoint: true })
eval_js: return await browser.screenshot()
```

Console errors are per-component, not whole-app noise. HMR is fast — only the story re-renders. Each story is a test case with specific props/args.

## Visual testing across variants

```js
const entries = JSON.parse(await browser.eval(
  "JSON.stringify(Object.keys(window.__STORYBOOK_PREVIEW__.storyStoreValue.storyIndex.entries))"
))
const results = []
for (const storyId of entries) {
  await browser.eval(`window.__STORYBOOK_ADDONS_CHANNEL__.emit('setCurrentStory', { storyId: '${storyId}' })`)
  await new Promise(r => setTimeout(r, 500))
  const screenshot = await browser.screenshot()
  results.push({ storyId, screenshot })
}
return results.map(r => r.storyId)
```

## Read component content

```js
// Markdown representation of what's rendered
return await browser.markdown()

// Raw text
return document.querySelector('#storybook-root').innerText

// HTML structure
return document.querySelector('#storybook-root').innerHTML
```

## Interact with rendered component

```js
await browser.click('text=Submit')
return await browser.screenshot()

await browser.fill('input[name="email"]', 'test@example.com')

await browser.click('text=Load')
await browser.waitFor('.loading-complete', 100, 5000)
return await browser.screenshot()
```

## Accessing the manager shell

MCP tools operate on the **preview iframe** by default. The manager is same-origin and accessible via `window.parent`:

```js
return await browser.eval("window.parent.document.querySelector('#storybook-explorer-tree')?.innerText")
```

## Setup

In `.storybook/main.ts`:

```ts
export default {
  addons: ['webdev-gateway/storybook'],
  framework: '@storybook/react-vite',
}
```

Start gateway + storybook:
```bash
npx webdev-gateway          # terminal 1
npm run storybook           # terminal 2
```

## Gotchas

- `document.*` hits the **preview iframe** (component DOM). Use `window.parent.document.*` for the manager shell.
- Use channel `emit('setCurrentStory')` for story navigation — URL-based navigation does not change the story.
- Storybook is fully SPA — RPC never disconnects during normal use.
- Storybook also ships its own MCP server (component docs, stories, props). webdev adds live browser observability on top.
- `#storybook-root` is the root element where stories render inside the preview iframe.
