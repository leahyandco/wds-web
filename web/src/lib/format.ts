const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export const EMPTY = '—'

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EMPTY
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date)
}

/** A date without its time, e.g. a driver's release date, which carries no meaningful time of day. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return EMPTY
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateOnly.format(date)
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

/** "1:05" or "12 s", for how long something has taken or will take. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return EMPTY
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}:${String(rest).padStart(2, '0')}`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** A WDS-friendly file name from an image name, matching the API's suggestion. */
export function suggestFileName(name: string): string {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug.length > 60) slug = slug.slice(0, 60).replace(/-+$/, '')
  return `${slug || 'image'}.wim`
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "5 minutes ago", "yesterday", and so on. */
export function formatAgo(value: string | null | undefined, now = Date.now()): string {
  if (!value) return EMPTY
  const seconds = (new Date(value).getTime() - now) / 1000
  if (Number.isNaN(seconds)) return value
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
  ]
  let amount = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(amount) < size) return relative.format(Math.round(amount), unit)
    amount /= size
  }
  return relative.format(Math.round(amount), 'year')
}

/** Renders any JSON value from a WDS record as a short string. */
export function formatValue(value: unknown): string {
  if (value == null || value === '') return EMPTY
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(', ') : EMPTY
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'string' && isoDate.test(value)) return formatDateTime(value)
  return String(value)
}
