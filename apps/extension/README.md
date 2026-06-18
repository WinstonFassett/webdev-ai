# webdev Chrome Extension

Optional extension that upgrades MCP browser tools from injected-client RPC to native Chrome DevTools Protocol (CDP) via `chrome.debugger`. Without it everything still works — this just makes it better.

**What you get with it:**
- Pixel-perfect screenshots (Playwright API instead of `html2canvas`)
- Reliable locators (Playwright's element resolution vs. injected JS)
- Proper OOPIF/iframe support
- On-demand debugger attach/detach — no persistent overhead

---

## Install

No build step required — the extension runs directly from source.

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select `apps/extension/` from this repo

The "webdev" extension appears in your list. Pin it to the toolbar if you want the status icon visible.

---

## How it works

The content script runs on every `localhost` page. When it finds a `<meta name="webdev">` tag (injected by `@winstonfassett/webdev-vite` or `@winstonfassett/webdev-nextjs`), it reads the gateway URL from the tag's `content` attribute and notifies the background service worker.

The background worker then:
1. Registers the tab as **available** (no debugger attached yet)
2. Connects to the gateway relay at `/__cdp-extension` via WebSocket
3. Announces the tab — `{ method: 'tabAvailable', params: { tabId, url, ... } }`

The gateway attaches the debugger on-demand (`requestDebug`) when an MCP tool needs it, and releases it (`releaseDebug`) when done. CDP events flow back through the relay to Playwright.

SPA navigations are handled — the content script watches for URL changes and re-runs detection.

---

## Verify it's working

1. Start the gateway (`npx webdev` or via adapter auto-start)
2. Open a dev page that has the adapter running (e.g. `http://localhost:5173`)
3. In the extension's background service worker console (`chrome://extensions` → webdev → **Service Worker**), you should see:
   ```
   [webdev] Dev page detected: tab 123 → http://localhost:5173/ (gateway: http://localhost:3333)
   [webdev] Connected to relay
   ```
4. Run an MCP tool that uses the browser (e.g. `browser_screenshot`). You'll see:
   ```
   [webdev] Debugger attached to tab 123
   ```

If the relay log shows `tabAvailable` arriving, the extension is wired up correctly.

---

## Permissions

| Permission | Why |
|---|---|
| `debugger` | Attach CDP to localhost tabs via `chrome.debugger` |
| `scripting` | Inject the detection script into the page world to read `window.__WEBDEV_LOADED__` (fallback when no meta tag) |
| `tabs` | Read tab URLs/titles; create/close tabs on `Target.createTarget` / `Target.closeTarget` |
| `storage` | Reserved for future config persistence |
| `host_permissions`: `localhost/*`, `127.0.0.1/*` | Scope all of the above to local dev servers only — never touches production pages |

---

## Without the extension

Everything degrades gracefully to the injected `webdev-client.js` RPC layer. Screenshots use `html2canvas`, clicks and queries go through `document.querySelector`. For most workflows this is fine. Install the extension when you need higher fidelity.
