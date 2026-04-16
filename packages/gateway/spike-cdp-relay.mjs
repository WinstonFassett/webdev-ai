#!/usr/bin/env node
/**
 * Spike Phase 0.2: CDP relay — WebSocket message-level proxy
 *
 * Sits between Playwright and Chrome's CDP port, forwarding WebSocket messages.
 * HTTP discovery endpoints (/json/version, /json/list) are proxied and rewritten.
 * WebSocket upgrade to /devtools/browser/* is intercepted and relayed.
 *
 * This is the pattern the extension will eventually replace —
 * instead of forwarding to Chrome's WS, we'll forward to/from the extension.
 *
 * Prerequisites:
 *   Chrome running with: --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp-test
 */

import { WebSocket, WebSocketServer } from 'ws'
import http from 'node:http'

const RELAY_PORT = parseInt(process.env.RELAY_PORT || '3400')
const CHROME_CDP_PORT = parseInt(process.env.CHROME_CDP_PORT || '9222')
const CHROME_HOST = '127.0.0.1'

// ------------------------------------------------------------------
// Discover Chrome's browser WS URL
// ------------------------------------------------------------------

async function getChromeWsUrl() {
  const res = await fetch(`http://${CHROME_HOST}:${CHROME_CDP_PORT}/json/version`)
  const info = await res.json()
  return info.webSocketDebuggerUrl
}

// ------------------------------------------------------------------
// HTTP: proxy /json/* endpoints with WS URL rewriting
// ------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = req.url?.replace(/\/$/, '') || ''

  if (url === '/json/version') {
    try {
      const chromeRes = await fetch(`http://${CHROME_HOST}:${CHROME_CDP_PORT}/json/version`)
      const info = await chromeRes.json()
      // Rewrite the WS URL to point to our relay
      const origPath = new URL(info.webSocketDebuggerUrl).pathname
      info.webSocketDebuggerUrl = `ws://127.0.0.1:${RELAY_PORT}${origPath}`
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(info))
      console.log(`[relay] /json/version → rewritten WS to relay (path: ${origPath})`)
    } catch (e) {
      res.writeHead(502)
      res.end(`Chrome not reachable: ${e.message}`)
    }
    return
  }

  if (url === '/json/list' || url === '/json') {
    try {
      const chromeRes = await fetch(`http://${CHROME_HOST}:${CHROME_CDP_PORT}${url}`)
      const targets = await chromeRes.json()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(targets))
    } catch (e) {
      res.writeHead(502)
      res.end(`Chrome not reachable: ${e.message}`)
    }
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

// ------------------------------------------------------------------
// WebSocket: handle upgrade manually so we control the handshake
// ------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', async (request, socket, head) => {
  console.log(`[relay] WS upgrade request: ${request.url}`)

  // Connect to Chrome's actual CDP WS FIRST, then accept Playwright's connection
  let chromeWsUrl
  try {
    chromeWsUrl = await getChromeWsUrl()
  } catch (e) {
    console.error(`[relay] Can't reach Chrome: ${e.message}`)
    socket.destroy()
    return
  }

  const chromeWs = new WebSocket(chromeWsUrl)

  chromeWs.on('open', () => {
    console.log('[relay] Chrome WS open, now accepting Playwright connection')

    // NOW accept Playwright's upgrade — Chrome is ready
    wss.handleUpgrade(request, socket, head, (playwrightWs) => {
      wss.emit('connection', playwrightWs, request)

      let stats = { toChrome: 0, fromChrome: 0 }

      // Forward: Playwright → Chrome
      playwrightWs.on('message', (data, isBinary) => {
        if (chromeWs.readyState === WebSocket.OPEN) {
          chromeWs.send(data, { binary: isBinary })
          stats.toChrome++
          if (stats.toChrome <= 3) {
            try { const j = JSON.parse(data); console.log(`[relay] PW→Chrome #${stats.toChrome}: ${j.method} (id=${j.id})`) } catch {}
          }
        }
      })

      // Forward: Chrome → Playwright
      chromeWs.on('message', (data, isBinary) => {
        if (playwrightWs.readyState === WebSocket.OPEN) {
          playwrightWs.send(data, { binary: isBinary })
          stats.fromChrome++
          if (stats.fromChrome <= 3) {
            try {
              const j = JSON.parse(data)
              if (j.method) console.log(`[relay] Chrome→PW #${stats.fromChrome}: ${j.method}`)
              else console.log(`[relay] Chrome→PW #${stats.fromChrome}: response id=${j.id}`)
            } catch {}
          }
        }
      })

      playwrightWs.on('close', (code) => {
        console.log(`[relay] Playwright disconnected (${code}). Messages: ${stats.toChrome}→chrome, ${stats.fromChrome}→pw`)
        chromeWs.close()
      })

      chromeWs.on('close', (code) => {
        console.log(`[relay] Chrome disconnected (${code})`)
        playwrightWs.close()
      })

      playwrightWs.on('error', (e) => { console.error(`[relay] PW error: ${e.message}`); chromeWs.close() })
      chromeWs.on('error', (e) => { console.error(`[relay] Chrome error: ${e.message}`); playwrightWs.close() })
    })
  })

  chromeWs.on('error', (err) => {
    console.error(`[relay] Chrome connection failed: ${err.message}`)
    socket.destroy()
  })
})

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------

server.listen(RELAY_PORT, '127.0.0.1', () => {
  console.log(`[relay] CDP WS relay on http://127.0.0.1:${RELAY_PORT} → Chrome at :${CHROME_CDP_PORT}`)
})
