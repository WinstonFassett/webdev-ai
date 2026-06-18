# Troubleshooting

**No browsers connected**: Make sure your dev app is open in a browser *after* the gateway is running. Check the browser console for connection errors.

**"Did it work?"**: Run `npx webdev doctor` after `init` + starting your dev server. Reports gateway reachability, framework wiring, adapter install, and MCP registration.

**Gateway not starting** (port in use): The gateway prints the offending PID — `Held by: PID 12345 (node). Either stop that process, or run with a different port: npx webdev -p <other-port>`. To investigate manually: `lsof -i :3333` (macOS/Linux) or `netstat -ano | findstr :3333` (Windows).

**MCP tools not appearing in agent**: Restart the agent after adding `.mcp.json`. Some agents require a reload to pick up new MCP servers.

**Turbopack: no logs appearing**: Did you add `<WebdevInit />` to your layout? Turbopack requires the explicit component — the config wrapper alone isn't enough. `npx webdev doctor` will flag this.

**HMR / build events not capturing**: The adapter forwards HMR via the gateway helper. If you wired the config manually but skipped the helper import, build events won't reach the gateway. Re-check the adapter wiring in your framework config.

### CSP-strict apps (script blocked)

If your app sets a strict Content-Security-Policy, the browser will block the injected client. Symptom: no MCP tools work, devtools console shows a CSP violation referencing `http://localhost:3333`.

Add to your dev-only CSP:

```
script-src  'self' http://localhost:3333;
connect-src 'self' http://localhost:3333 ws://localhost:3333;
```

Or use **proxy mode** (`http://localhost:3333/http://localhost:YOUR_PORT/`) — the gateway serves the page same-origin, so the script is never cross-origin and CSP doesn't fire.

### HTTPS dev servers (mixed-content block)

If your dev server uses HTTPS (e.g. `vite --https`, webpack-dev-server with HTTPS), the page origin is `https://`. The injected script's `http://localhost:3333` URL is mixed-content and will be blocked.

Three options:

1. **Run the gateway with HTTPS too** — `npx webdev --https` (self-signed). Trust the cert in your browser, then the page can reach `https://localhost:3333`.
2. **Use a tunnel** like `cloudflared` or `ngrok` that gives you `wss://` for the gateway URL.
3. **Drop HTTPS in dev** — usually the simplest path; HTTPS-only behaviors (e.g. service workers) are out of scope for this tool.

### Devcontainers / Codespaces / Docker

The page runs in your host browser; the gateway needs to be reachable from the same network as both the page and the agent. Two configurations work:

**Gateway inside the container** (recommended for Codespaces): run the gateway alongside your dev server. VS Code's auto port forwarding will surface `:3333` as `localhost:3333` to your host browser.

```jsonc
// .devcontainer/devcontainer.json
{
  "forwardPorts": [3333, 5173]   // gateway + your dev server
}
```

**Gateway on the host, dev server in the container**: page reaches `localhost:3333` (host) directly. The container needs to reach the host gateway too — use `host.docker.internal:3333` from within the container if any code there talks back to the gateway.

> If the agent is also remote (Claude Code in a tunnel, etc.), point its MCP config at the publicly-reachable URL — not `localhost`.
