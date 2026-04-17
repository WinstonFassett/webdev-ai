'use client'

/**
 * Pre-built client component for Next.js Turbopack mode.
 *
 * Usage in app/layout.tsx:
 *   import { WebDevMcpInit } from '@winstonfassett/web-dev-mcp-nextjs/init'
 *   // <WebDevMcpInit /> in <body>
 *
 * Webpack mode doesn't need this — client.js is injected automatically via webpack entry.
 */

import { useEffect } from 'react'

export function WebDevMcpInit() {
  useEffect(() => {
    if ((window as any).__WEB_DEV_MCP_LOADED__) return

    if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER) {
      (window as any).__WEB_DEV_MCP_SERVER__ = process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER
    }
    if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY) {
      (window as any).__WEB_DEV_MCP_ORIGIN__ = process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY
    }

    // Meta tag for extension auto-detection
    const meta = document.createElement('meta')
    meta.name = 'web-dev-mcp'
    meta.content = process.env.NEXT_PUBLIC_WEB_DEV_MCP_GATEWAY || ''
    if (process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER) {
      meta.setAttribute('data-server-id', process.env.NEXT_PUBLIC_WEB_DEV_MCP_SERVER)
    }
    document.head.appendChild(meta)

    const script = document.createElement('script')
    script.src = '/__web-dev-mcp.js'
    script.async = true
    document.head.appendChild(script)
  }, [])

  return null
}
