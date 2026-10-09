/** Which column a table is sorted by, and which way. */
export interface Sort {
  key: string
  descending: boolean
}

const text = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const isoDate = /^\d{4}-\d{2}-\d{2}T/
const version = /^\d+(\.\d+)+$/

/** Compares two values the way people expect: numbers and dates by value, versions part by part, text with numbers in order. */
export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(b) - Number(a)
  const x = String(a)
  const y = String(b)
  if (isoDate.test(x) && isoDate.test(y)) return new Date(x).getTime() - new Date(y).getTime()
  if (version.test(x) && version.test(y)) {
    const xs = x.split('.').map(Number)
    const ys = y.split('.').map(Number)
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const difference = (xs[i] ?? 0) - (ys[i] ?? 0)
      if (difference !== 0) return difference
    }
    return 0
  }
  return text.compare(x, y)
}

/** Rows sorted by one of their values; rows without a value go last either way. */
export function sortRows<T>(rows: T[], value: (row: T) => unknown, descending: boolean): T[] {
  return [...rows].sort((left, right) => {
    const a = value(left)
    const b = value(right)
    const aEmpty = a == null || a === ''
    const bEmpty = b == null || b === ''
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
    const order = compareValues(a, b)
    return descending ? -order : order
  })
}

/** A sort kept in the address as ?sort=key&desc=1. */
export const sortFromParams = (params: URLSearchParams): Sort | null => {
  const key = params.get('sort')
  return key ? { key, descending: params.get('desc') === '1' } : null
}

export const sortToParams = (sort: Sort) => ({ sort: sort.key, desc: sort.descending ? '1' : null })
