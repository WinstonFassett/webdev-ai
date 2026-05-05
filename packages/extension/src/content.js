/**
 * Content script — runs on localhost pages.
 * Detects if this page has webdev injected client and notifies the background worker.
 *
 * Detection signals (checked in order):
 * 1. <meta name="webdev" content="ws://localhost:3333"> (preferred — contains gateway URL)
 * 2. window.__WEBDEV_LOADED__ global (set by injected client)
 */

console.log('[webdev content] Content script loaded on', location.href)

function detect() {
  // Check meta tag first — it has the gateway URL
  const meta = document.querySelector('meta[name="webdev"]')
  console.log('[webdev content] Meta tag:', meta ? 'found' : 'not found')
  if (meta) {
    const gatewayUrl = meta.getAttribute('content') || ''
    const serverId = meta.getAttribute('data-server-id') || ''
    const projectId = meta.getAttribute('data-project-id') || ''
    chrome.runtime.sendMessage({
      type: 'dev-page-detected',
      url: location.href,
      gatewayUrl,
      serverId,
      projectId,
    })
    return
  }

  // Fallback: check for the global flag (need to read from page world via script injection)
  const script = document.createElement('script')
  script.textContent = `
    if (window.__WEBDEV_LOADED__) {
      document.dispatchEvent(new CustomEvent('__webdev_detected', {
        detail: {
          origin: window.__WEBDEV_ORIGIN__ || '',
          serverId: window.__WEBDEV_SERVER__ || '',
        }
      }));
    }
  `
  document.addEventListener('__webdev_detected', (e) => {
    chrome.runtime.sendMessage({
      type: 'dev-page-detected',
      url: location.href,
      gatewayUrl: e.detail.origin,
      serverId: e.detail.serverId,
      projectId: '',
    })
  }, { once: true })

  document.documentElement.appendChild(script)
  script.remove()
}

// Run detection after a short delay to ensure injected client has loaded
setTimeout(detect, 500)

// Also re-detect on SPA navigations
let lastUrl = location.href
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href
    setTimeout(detect, 500)
  }
})
observer.observe(document, { subtree: true, childList: true })
