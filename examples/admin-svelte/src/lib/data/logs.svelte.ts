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
export function pushLogEvent(data: { channel: string; payload: any; browserId?: string }) {
  const entry: LogEntry = {
    type: 'log',
    channel: data.channel ?? 'unknown',
    payload: data.payload,
    browserId: data.browserId ?? data.payload?.browserId,
    serverId: data.payload?.serverId,
    timestamp: Date.now(),
  }

  if (_entries.length >= MAX_ENTRIES) {
    _entries.splice(0, _entries.length - MAX_ENTRIES + 1)
  }
  _entries.push(entry)
}

/** Load historical logs for a server via RPC */
export async function loadHistory(serverId?: string) {
  const api = getApi()
  if (!api) return

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
          timestamp: event.ts ?? Date.now(),
        })
      }
    }

    if (batch.length > 0) {
      _entries.push(...batch)
      _entries.sort((a, b) => a.timestamp - b.timestamp)
    }
  } catch {
    // History is best-effort
  }
}

/** Clear all entries */
export function clearEntries() {
  _entries.splice(0, _entries.length)
}
