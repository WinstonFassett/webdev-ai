'use client'

/**
 * Pre-built client component for Next.js Turbopack mode.
 *
 * Usage in app/layout.tsx:
 *   import { WebDevMcpInit } from '@winstonfassett/webdev-nextjs/init'
 *   // <WebDevMcpInit /> in <body>
 *
 * Webpack mode doesn't need this — client.js is injected automatically via webpack entry.
 */

import { useEffect } from 'react'

export function WebDevMcpInit() {
  useEffect(() => {
    // process.env.NODE_ENV is inlined by Next.js at build time. In prod the
    // entire useEffect body is dead-code-eliminated.
    if (process.env.NODE_ENV !== 'development') return
    if (!process.env.NEXT_PUBLIC_WEBDEV_GATEWAY) return
    if ((window as any).__WEBDEV_LOADED__) return

    if (process.env.NEXT_PUBLIC_WEBDEV_SERVER) {
      (window as any).__WEBDEV_SERVER__ = process.env.NEXT_PUBLIC_WEBDEV_SERVER
    }
    (window as any).__WEBDEV_ORIGIN__ = process.env.NEXT_PUBLIC_WEBDEV_GATEWAY

    // Meta tag for extension auto-detection
    const meta = document.createElement('meta')
    meta.name = 'webdev'
    meta.content = process.env.NEXT_PUBLIC_WEBDEV_GATEWAY
    if (process.env.NEXT_PUBLIC_WEBDEV_SERVER) {
      meta.setAttribute('data-server-id', process.env.NEXT_PUBLIC_WEBDEV_SERVER)
    }
    document.head.appendChild(meta)

    const script = document.createElement('script')
    script.src = '/__webdev.js'
    script.async = true
    document.head.appendChild(script)
  }, [])

  return null
}
