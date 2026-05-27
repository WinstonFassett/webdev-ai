// Dock action script for @vitejs/devtools — runs in the host page context.
// Clicking the dock entry toggles the existing webdev element-grab picker
// (window.__elementGrab is mounted by the gateway's element-grab client).

import type { DockClientScriptContext } from '@vitejs/devtools-kit/client'

interface ElementGrabAPI {
  activate: () => void
  deactivate: () => void
  isActive: () => boolean
}

function getApi(): ElementGrabAPI | null {
  return (window as any).__elementGrab ?? null
}

export default function setup(ctx: DockClientScriptContext) {
  ctx.current.events.on('entry:activated', () => {
    const api = getApi()
    if (!api) {
      console.warn('[webdev] element-grab API not loaded yet — try again in a moment')
      return
    }
    api.activate()
  })

  ctx.current.events.on('entry:deactivated', () => {
    const api = getApi()
    if (api?.isActive()) api.deactivate()
  })
}
