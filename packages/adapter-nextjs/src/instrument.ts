/**
 * Browser instrumentation for Next.js apps (webpack mode).
 * Loaded automatically via webpack entry injection from withWebDevMcp().
 *
 * For Turbopack, use <WebdevInit /> from '@winstonfassett/webdev-nextjs/init' instead.
 */
if (typeof window !== 'undefined' && !(window as any).__WEBDEV_INSTRUMENT__) {
  ;(window as any).__WEBDEV_INSTRUMENT__ = true
  if (process.env.NEXT_PUBLIC_WEBDEV_SERVER) {
    (window as any).__WEBDEV_SERVER__ = process.env.NEXT_PUBLIC_WEBDEV_SERVER
  }
  if (process.env.NEXT_PUBLIC_WEBDEV_GATEWAY) {
    (window as any).__WEBDEV_ORIGIN__ = process.env.NEXT_PUBLIC_WEBDEV_GATEWAY
  }
  // Meta tag for extension auto-detection
  const meta = document.createElement('meta')
  meta.name = 'webdev'
  meta.content = process.env.NEXT_PUBLIC_WEBDEV_GATEWAY || ''
  if (process.env.NEXT_PUBLIC_WEBDEV_SERVER) {
    meta.setAttribute('data-server-id', process.env.NEXT_PUBLIC_WEBDEV_SERVER)
  }
  document.head.appendChild(meta)

  const script = document.createElement('script')
  script.src = '/__webdev.js'
  script.async = true
  document.head.appendChild(script)
}
