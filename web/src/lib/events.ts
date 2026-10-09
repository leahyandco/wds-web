import type { WdsEvent } from '../api/types'

const levelNames = ['Information', 'Critical', 'Error', 'Warning', 'Information', 'Verbose']

export const isProblem = (event: WdsEvent) => event.level >= 1 && event.level <= 3

/** Names an event across reloads: its log and its number there. */
export const eventKey = (event: WdsEvent) => `${event.log}|${event.recordId}`

const DIAGNOSTICS = 'Microsoft-Windows-Deployment-Services-Diagnostics'

/**
 * Warnings WDS logs in the normal run of things, which Boot activity explains instead of flagging:
 * - 4107 "downgraded image transfer" with no multicast namespace, logged for every install straight from the
 *   server's share, which is how images without a multicast transmission install.
 * - WDSIMGSRV 270, the refused unattend request, when WDS had no unattend file for that client anyway
 *   (`unattendExpected` says whether it had).
 */
export function isExpectedWarning(event: WdsEvent, unattendExpected: (event: WdsEvent) => boolean): boolean {
  if (event.provider === DIAGNOSTICS && event.id === 4107) return !(event.data.MulticastNamespace ?? '').trim()
  if (event.provider === 'WDSIMGSRV' && event.id === 270) return !unattendExpected(event)
  return false
}

export const levelLabel = (event: WdsEvent) => event.levelName ?? levelNames[event.level] ?? `Level ${event.level}`

/** A short name for where an event came from, e.g. "WDS diagnostics · Operational". */
export function sourceLabel(event: WdsEvent): string {
  if (event.provider === 'Microsoft-Windows-Deployment-Services-Diagnostics') {
    return `WDS diagnostics · ${event.log.split('/').pop()}`
  }
  if (event.provider === 'WDSServer') return `WDS service · ${event.log}`
  return `${event.provider} · ${event.log}`
}

export function levelColor(level: number): string {
  if (level === 1 || level === 2) return 'red'
  if (level === 3) return 'yellow'
  if (level === 5) return 'gray'
  return 'blue'
}
