import type { WdsEvent } from '../api/types'

const levelNames = ['Information', 'Critical', 'Error', 'Warning', 'Information', 'Verbose']

export const isProblem = (event: WdsEvent) => event.level >= 1 && event.level <= 3

export const levelLabel = (event: WdsEvent) => event.levelName ?? levelNames[event.level] ?? `Level ${event.level}`

export function levelColor(level: number): string {
  if (level === 1 || level === 2) return 'red'
  if (level === 3) return 'yellow'
  if (level === 5) return 'gray'
  return 'blue'
}
