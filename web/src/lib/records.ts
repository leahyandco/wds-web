import type { RecordColumn } from '../components/RecordTable'
import type { WdsRecord } from '../api/types'

export const asString = (value: unknown) => (typeof value === 'string' ? value : null)
export const asNumber = (value: unknown) => (typeof value === 'number' ? value : null)

/** The first of several property names that has a value. */
export function pick(record: WdsRecord, ...names: string[]): unknown {
  for (const name of names) {
    const value = record[name]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

/**
 * Columns for records whose shape isn't pinned down yet: the preferred properties that appear in the
 * data, in the order given, or else the first few properties.
 */
export function autoColumns(rows: WdsRecord[], preferred: string[], max = 6): RecordColumn[] {
  const present = new Set(rows.flatMap((row) => Object.keys(row)))
  const keys = preferred.filter((key) => present.has(key))
  const chosen = keys.length > 0 ? keys : [...present]
  return chosen.slice(0, max).map((key) => ({ key, label: key.replace(/([a-z])([A-Z])/g, '$1 $2') }))
}
