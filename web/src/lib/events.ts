import type { WdsEvent } from '../api/types'

const levelNames = ['Information', 'Critical', 'Error', 'Warning', 'Information', 'Verbose']

export const isProblem = (event: WdsEvent) => event.level >= 1 && event.level <= 3

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
