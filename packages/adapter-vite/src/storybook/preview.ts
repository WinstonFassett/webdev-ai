/**
 * Storybook preview decorator — fallback client.js injection
 *
 * Safety net for Storybook configurations that bypass Vite's HTML pipeline.
 * Dev-only — never runs in `storybook build` output.
 */

if (
  process.env.NODE_ENV === 'development' &&
  typeof window !== 'undefined' &&
  !(window as any).__WEBDEV_LOADED__
) {
  const script = document.createElement('script')
  script.src = '/__webdev.js'
  script.async = true
  document.head.appendChild(script)
}
