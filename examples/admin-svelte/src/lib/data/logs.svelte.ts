/**
 * Log store — accumulates log entries from the live event stream.
 *
 * NOTE: The admin app has webDevMcp() plugin, so its own console.log messages
 * get captured by the gateway and streamed back. Do NOT console.log inside
 * the event handlers or it creates a feedback loop.
 */

import { getApi, type AdminAPI } from './connection'

export interface LogEntry {
  type: string
  channel: string
  payload: any
  browserId?: string
  serverId?: string
  connId?: string
  timestamp: number
}

const MAX_ENTRIES = 5000

let _entries: LogEntry[] = $state([])

export function getLogEntries(): LogEntry[] {
  return _entries
}

/** Push a log event from the live stream */
export function pushLogEvent(data: { channel: string; payload: any; browserId?: string; serverId?: string }) {
  const entry: LogEntry = {
    type: 'log',
    channel: data.channel ?? 'unknown',
    payload: data.payload,
    browserId: data.browserId ?? data.payload?.browserId,
    serverId: data.serverId ?? data.payload?.serverId,
    timestamp: Date.now(),
  }

  if (_entries.length >= MAX_ENTRIES) {
    _entries.splice(0, _entries.length - MAX_ENTRIES + 1)
  }
  _entries.push(entry)
}

const _loadedServers = new Set<string>()

/** Load historical logs for a server via RPC (deduped; safe to call from multiple views) */
export async function loadHistory(serverId?: string) {
  if (!serverId || _loadedServers.has(serverId)) return
  _loadedServers.add(serverId)

  const api = getApi()
  if (!api) {
    _loadedServers.delete(serverId)
    return
  }

  try {
    const data = await api.getLogs({ serverId, limit: 200 }) as any
    const channels = data?.logs ?? {}

    const batch: LogEntry[] = []
    for (const [channel, events] of Object.entries(channels)) {
      if (!Array.isArray(events)) continue
      for (const event of events as any[]) {
        batch.push({
          type: 'log',
          channel: event.channel ?? channel,
          payload: event.payload,
          browserId: event.payload?.browserId,
          serverId,
          timestamp: event.ts ?? Date.now(),
        })
      }
    }

    if (batch.length > 0) {
      _entries.push(...batch)
      _entries.sort((a, b) => a.timestamp - b.timestamp)
    }
  } catch {
    _loadedServers.delete(serverId)
  }
}

/** Clear in-memory entries only (does not touch server files) */
export function clearEntries() {
  _entries.splice(0, _entries.length)
}

interface ClearOpts {
  serverId?: string
  serverIds?: string[]
  browserId?: string
  channels?: string[]
}

/**
 * Clear entries client-side AND ask the server to persist the clear.
 * Scope semantics mirror the server's clearLogs():
 *   - browserId: per-browser checkpoint (no file truncation — browsers share files)
 *   - serverId or serverIds: truncate NDJSON files
 *   - none: truncate everything
 * Channels filter, when present, narrows file truncation to those channels.
 */
export async function clearAllLogs(opts?: ClearOpts) {
  const matches = (e: LogEntry) => {
    if (opts?.browserId) {
      if (e.browserId !== opts.browserId && e.connId !== opts.browserId) return false
    }
    if (opts?.serverId) {
      if (e.serverId !== opts.serverId) return false
    }
    if (opts?.serverIds?.length) {
      if (!e.serverId || !opts.serverIds.includes(e.serverId)) return false
    }
    if (opts?.channels?.length) {
      if (!opts.channels.includes(e.channel)) return false
    }
    return true
  }

  if (!opts || (!opts.browserId && !opts.serverId && !opts.serverIds?.length && !opts.channels?.length)) {
    // Global clear
    clearEntries()
    _loadedServers.clear()
  } else {
    for (let i = _entries.length - 1; i >= 0; i--) {
      if (matches(_entries[i])) _entries.splice(i, 1)
    }
    if (opts.serverId) _loadedServers.delete(opts.serverId)
    if (opts.serverIds?.length) {
      for (const id of opts.serverIds) _loadedServers.delete(id)
    }
  }

  const api = getApi()
  if (!api) return
  try {
    await api.clearLogs(opts)
  } catch {
    // Best-effort — client entries already cleared
  }
}
