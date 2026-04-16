/**
 * Background service worker — the core of the extension.
 *
 * Lifecycle:
 * 1. Content script detects a dev page → sends 'dev-page-detected' message
 * 2. We call chrome.debugger.attach() on that tab
 * 3. We open a WebSocket to the gateway's CDP relay endpoint
 * 4. CDP commands from relay → chrome.debugger.sendCommand() on the tab
 * 5. CDP events from chrome.debugger.onEvent → relay
 *
 * Protocol between extension ↔ relay:
 *   Extension → Relay:  { method: 'forwardCDPEvent', params: { sessionId, method, params } }
 *   Relay → Extension:  { id, method: 'forwardCDPCommand', params: { sessionId, method, params } }
 *   Extension → Relay:  { id, result } or { id, error }
 */

// ---- State ----

/** @type {Map<number, { sessionId: string, targetId: string }>} tabId → session info */
const attachedTabs = new Map()

/** @type {WebSocket | null} */
let relayWs = null

/** @type {string} Gateway URL from the content script detection */
let gatewayUrl = ''

/** Session scope — changes on each relay reconnect to avoid stale session IDs */
let sessionScope = Date.now().toString(36)
let nextSessionId = 1

/** Cached Target.setAutoAttach params — applied to newly attached tabs */
let autoAttachParams = null

// ---- Content script message handler ----

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'dev-page-detected' && sender.tab?.id) {
    const tabId = sender.tab.id
    if (attachedTabs.has(tabId)) return // already attached

    gatewayUrl = msg.gatewayUrl || 'http://localhost:3333'
    console.log(`[web-dev-mcp] Dev page detected: tab ${tabId} → ${msg.url} (gateway: ${gatewayUrl})`)

    attachTab(tabId)
  }
})

// ---- CDP event forwarding (chrome → relay) ----

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId
  if (!tabId) return
  const tab = attachedTabs.get(tabId)
  if (!tab) return

  // Use the child sessionId for OOPIF events, fall back to the tab's main sessionId
  const sessionId = source.sessionId || tab.sessionId

  sendToRelay({
    method: 'forwardCDPEvent',
    params: { sessionId, method, params },
  })
})

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId
  if (!tabId || !attachedTabs.has(tabId)) return

  const tab = attachedTabs.get(tabId)
  console.log(`[web-dev-mcp] Debugger detached: tab ${tabId}, reason: ${reason}`)

  if (tab) {
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    })
  }

  attachedTabs.delete(tabId)
})

// ---- Tab lifecycle ----

async function attachTab(tabId) {
  const debuggee = { tabId }

  try {
    await chrome.debugger.attach(debuggee, '1.3')
    console.log(`[web-dev-mcp] Debugger attached to tab ${tabId}`)

    await chrome.debugger.sendCommand(debuggee, 'Page.enable')

    if (autoAttachParams) {
      try {
        await chrome.debugger.sendCommand(debuggee, 'Target.setAutoAttach', autoAttachParams)
      } catch (e) {
        console.warn(`[web-dev-mcp] Failed to apply auto-attach for tab ${tabId}:`, e)
      }
    }

    const result = await chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo')
    const targetInfo = result.targetInfo
    console.log(`[web-dev-mcp] Target.getTargetInfo result:`, JSON.stringify(targetInfo))

    // Target.getTargetInfo often returns empty/broken URL via chrome.debugger; get from tab API
    if (!targetInfo.url || targetInfo.url === '' || targetInfo.url === ':') {
      const tab = await chrome.tabs.get(tabId)
      targetInfo.url = tab.url || ''
      targetInfo.title = tab.title || ''
    }

    const sessionId = `wdm-tab-${sessionScope}-${nextSessionId++}`

    attachedTabs.set(tabId, { sessionId, targetId: targetInfo.targetId, url: targetInfo.url, targetInfo })

    // Connect to relay if not already connected
    ensureRelayConnection()

    // Notify relay that this target is attached
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.attachedToTarget',
        params: {
          sessionId,
          targetInfo: { ...targetInfo, attached: true },
          waitingForDebugger: false,
        },
      },
    })

    console.log(`[web-dev-mcp] Tab ${tabId} attached: session=${sessionId}, url=${targetInfo.url}`)
  } catch (e) {
    console.error(`[web-dev-mcp] Failed to attach tab ${tabId}:`, e.message)
  }
}

// ---- CDP command handling (relay → chrome) ----

async function handleCommand(msg) {
  const { id, params } = msg
  const { sessionId, method, params: cmdParams } = params

  try {
    let result

    // Special cases (same patterns as Playwriter)
    switch (method) {
      case 'Target.setAutoAttach': {
        if (!sessionId) {
          // Root-level: apply to all connected tabs
          autoAttachParams = cmdParams
          const promises = [...attachedTabs.entries()].map(([tabId]) =>
            chrome.debugger.sendCommand({ tabId }, 'Target.setAutoAttach', cmdParams).catch(() => {})
          )
          await Promise.all(promises)
          result = {}
          break
        }
        // Session-level: fall through to default
      }
      // falls through

      case 'Runtime.enable': {
        const tab = findTabForSession(sessionId)
        if (!tab) throw new Error(`No tab for session ${sessionId}`)
        const debuggerSession = {
          tabId: tab.tabId,
          sessionId: sessionId !== tab.info.sessionId ? sessionId : undefined,
        }
        // Disable/re-enable to force re-emission of executionContextCreated events
        try {
          await chrome.debugger.sendCommand(debuggerSession, 'Runtime.disable')
        } catch {}
        result = await chrome.debugger.sendCommand(debuggerSession, 'Runtime.enable', cmdParams)
        break
      }

      case 'Target.createTarget': {
        const url = cmdParams?.url || 'about:blank'
        const newTab = await chrome.tabs.create({ url, active: false })
        if (!newTab.id) throw new Error('Failed to create tab')
        await new Promise(r => setTimeout(r, 100))
        await attachTab(newTab.id)
        const info = attachedTabs.get(newTab.id)
        result = { targetId: info?.targetId }
        break
      }

      case 'Target.closeTarget': {
        const tab = findTabForTarget(cmdParams?.targetId)
        if (tab) {
          await chrome.tabs.remove(tab.tabId)
          result = { success: true }
        } else {
          result = { success: false }
        }
        break
      }

      default: {
        const tab = findTabForSession(sessionId)
        if (!tab) throw new Error(`No tab for session ${sessionId}, method ${method}`)
        const debuggerSession = {
          tabId: tab.tabId,
          sessionId: sessionId !== tab.info.sessionId ? sessionId : undefined,
        }
        result = await chrome.debugger.sendCommand(debuggerSession, method, cmdParams)
      }
    }

    sendToRelay({ id, result: result || {} })
  } catch (e) {
    sendToRelay({ id, error: { message: e.message } })
  }
}

// ---- Helper: find tab by session or target ID ----

function findTabForSession(sessionId) {
  for (const [tabId, info] of attachedTabs) {
    if (info.sessionId === sessionId) return { tabId, info }
  }
  return null
}

function findTabForTarget(targetId) {
  for (const [tabId, info] of attachedTabs) {
    if (info.targetId === targetId) return { tabId, info }
  }
  return null
}

// ---- Relay WebSocket connection ----

function ensureRelayConnection() {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) return

  const wsUrl = gatewayUrl.replace(/^http/, 'ws') + '/__cdp-extension'
  console.log(`[web-dev-mcp] Connecting to relay at ${wsUrl}`)

  relayWs = new WebSocket(wsUrl)

  relayWs.onopen = () => {
    console.log('[web-dev-mcp] Connected to relay')

    // Re-announce all attached tabs
    for (const [tabId, info] of attachedTabs) {
      sendToRelay({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId: info.sessionId,
            targetInfo: info.targetInfo || { targetId: info.targetId, type: 'page', attached: true, url: info.url || '' },
            waitingForDebugger: false,
          },
        },
      })
    }
  }

  relayWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.method === 'forwardCDPCommand') {
        handleCommand(msg)
      } else if (msg.method === 'ping') {
        sendToRelay({ method: 'pong' })
      }
    } catch (e) {
      console.error('[web-dev-mcp] Failed to parse relay message:', e)
    }
  }

  relayWs.onclose = () => {
    console.log('[web-dev-mcp] Relay disconnected, will reconnect on next detection')
    relayWs = null
  }

  relayWs.onerror = (e) => {
    console.error('[web-dev-mcp] Relay WebSocket error')
    relayWs = null
  }
}

function sendToRelay(msg) {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) {
    relayWs.send(JSON.stringify(msg))
  }
}

// ---- Tab removed cleanup ----

chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs.has(tabId)) {
    const tab = attachedTabs.get(tabId)
    sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Target.detachedFromTarget',
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    })
    attachedTabs.delete(tabId)
    console.log(`[web-dev-mcp] Tab ${tabId} removed, cleaned up`)
  }
})

console.log('[web-dev-mcp] Background service worker loaded')
