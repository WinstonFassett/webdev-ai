---
name: webdev

description: Only invoke when the user or a project instruction file explicitly names "webdev" — not because the task involves a browser, screenshots, or dev tools. Do not infer this from capability match. Requires the developer's own gateway and dev server to already be running.
---

# webdev

Controls an already-open browser tab during development. MCP server at `/__mcp/sse`.

## Installation (owner must approve)

To add webdev to a project:

```bash
npx webdev init
```

This detects your framework, wires the adapter, installs dependencies, and registers the MCP server with your agent. See [getting-started.md](https://github.com/WinstonFassett/webdev/blob/main/getting-started.md) for manual setup options.

## First call: set project context

**Always call `set_project` with your working directory as the first action:**

```
set_project({ project: "/path/to/your/project" })
```

This matches your cwd against registered projects (exact, parent, or child directory match). If only one project is registered, tools auto-resolve without this call.

To discover available projects by short ID:

```
list_projects → [{ id: "nextjs-turbopack-a3f7", ... }, ...]
set_project({ project: "nextjs-turbopack-a3f7" })
```

## Core tools

### `list_projects` / `list_browsers` / `set_project`

Gateway-scoped — work without a project context. Use to discover and select projects.

### `get_diagnostics`

Server-side. Reads NDJSON log files + HMR/build status. One call for everything.

```
get_diagnostics({ since_checkpoint: true })  # only events since last clear
get_diagnostics({ level: "error" })          # filter by level
get_diagnostics({ search: "TypeError" })     # text search
```

### `clear`

Truncate log files and set checkpoint. Call before a code change so `get_diagnostics(since_checkpoint)` shows only new events.

```
clear                                        # truncate all log channels
clear({ channels: ["console"] })             # truncate specific channel
```

### `eval_js`

Runs JavaScript directly in the browser. Full DOM access, multi-statement, supports await.

**Globals available in code:**

| Name | What it is |
|---|---|
| `document` | Real browser document. querySelector, textContent, etc. |
| `window` | Real browser window. location, localStorage, etc. |
| `state` | Persists across calls within a browser session. Store refs to DOM elements, framework stores, etc. |
| `browser.eval(expression)` | Eval a JS expression and return its string result. |
| `browser.markdown(selector?)` | Element/page to markdown with `[links](urls)` |
| `browser.screenshot(selectorOrOpts?)` | Screenshot. String=selector, or `{preset, format, quality}`. Presets: viewport (default), element, thumb, full, hd. |
| `browser.elementSource(selector)` | Map DOM element to source code. Returns `{componentName, source: {filePath, lineNumber}}`. Requires `element-source` in the app. |
| `browser.navigate(url)` | Change page (disconnects, wait before next call) |
| `browser.click(selector)` | Click. Supports `text=` prefix for text matching. |
| `browser.fill(selector, value)` | Fill input. Supports `text=` prefix. |
| `browser.waitFor(selectorOrFn, interval?, timeout?)` | Poll until element exists or function returns truthy |

## Workflow: test-fix loop

```
clear
# make code change — HMR reloads
get_diagnostics({ since_checkpoint: true })
# check errors, then visual:
eval_js: return await browser.screenshot()
```

## Examples

**Read page content:**
```js
// as markdown (links, headings, form elements)
return browser.markdown('#main-content')

// as plain text
return document.querySelector('#main-content').innerText

// as HTML structure
return document.querySelector('#main-content').innerHTML
```

**Find source code for an element by its text:**
```js
const info = await browser.elementSource('text=Total: $NaN')
// → { componentName: "OrderSummary", source: { filePath: "/src/checkout/OrderSummary.tsx", lineNumber: 43 } }

// Also works with CSS selectors:
const info2 = await browser.elementSource('.price-widget .total')

// Requires element-source in the app (npm install element-source).
```

**Click by text:**
```js
browser.click('text=Submit')
```

**Fill a form:**
```js
browser.fill('#email', 'test@example.com')
browser.fill('#password', 'secret')
browser.click('text=Sign In')
```

**Wait for async UI:**
```js
await browser.click('text=Load Data')
const toast = await browser.waitFor('.success-toast', 100, 5000)
return toast.textContent
```

**Hold a ref across calls:**
```js
// Call 1: store a ref
state.store = window.__REDUX_STORE__
return JSON.stringify(state.store.getState())

// Call 2 (later): same ref, still alive
return JSON.stringify(state.store.getState())
```

## Monitoring logs

**Tail NDJSON files:**
```bash
tail -f .webdev/console.ndjson
tail -f .webdev/errors.ndjson
```

**Admin UI** (`/__admin`): visual dashboard with real-time log viewer, browser list, REPL.

## Gotchas

- `browser.navigate()` disconnects — wait ~2-3s before next call. For SPA route changes, prefer `browser.click('text=Settings')` on a nav element.
- `browser.screenshot()` returns JSON with base64 data, not MCP image content type.
- `state` persists within a browser session. Page reload clears it.
