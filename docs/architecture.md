# Architecture

Three actors, one local gateway holding them together.

```mermaid
graph TB
    AGENT["AI Agent<br/>(Claude / Cursor / Windsurf / VS Code)"]

    subgraph GW["Gateway :3333"]
        REG[("Server<br/>registry")]
        LOGS[("Log writers<br/>NDJSON")]
        MCP["MCP server<br/>/__mcp/sse"]
        ADMIN["Admin UI<br/>/__admin"]
    end

    subgraph DEV["Your dev project"]
        SERVER["Dev server<br/>(Vite / Next / Astro / Storybook)"]
        ADAPTER["webdev adapter"]
        BROWSER["Browser tab<br/>(your app)"]
        CLIENT["Injected client<br/>(console patch + RPC)"]
    end

    SERVER -->|hosts| ADAPTER
    ADAPTER -->|registers + dev events| REG
    ADAPTER -->|injects| CLIENT
    BROWSER -->|runs| CLIENT
    CLIENT -->|console + errors + network| LOGS
    CLIENT <-->|RPC commands + results| MCP
    AGENT <-->|tool calls| MCP
    MCP -->|reads| LOGS
    MCP -->|reads| REG
```

A single tool call flows like this:

```mermaid
sequenceDiagram
    participant Agent
    participant Gateway
    participant Browser

    Browser->>Gateway: WebSocket — event stream + command channel
    Agent->>Gateway: MCP tool call (e.g. eval_js)
    Gateway->>Browser: JSON command
    Browser-->>Gateway: result
    Gateway-->>Agent: MCP response
```

The injected client script:
- Patches `console.*`, `fetch`, `XMLHttpRequest` to relay events to NDJSON log files
- Connects to `/__rpc` via WebSocket for JSON commands
- Handles commands: eval, screenshot, click, fill, navigate, queryDom, markdown, etc.

When the Chrome extension is installed, `browser_*` tools upgrade transparently to Playwright via CDP — pixel-perfect screenshots and reliable locators, transparent to the agent.
