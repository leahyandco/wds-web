const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export const EMPTY = '—'

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EMPTY
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date)
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return EMPTY
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** Renders any JSON value from a WDS record as a short string. */
export function formatValue(value: unknown): string {
  if (value == null || value === '') return EMPTY
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(', ') : EMPTY
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && isoDate.test(value)) return formatDateTime(value)
  return String(value)
}
