/** A CSV field, quoted when it holds a comma, quote or line break. */
const field = (value: unknown) => {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Rows as CSV text, with Windows line endings for Excel. */
export const toCsv = (rows: unknown[][]) => rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n'

/** Saves rows as a .csv file, with a byte order mark so Excel reads it as UTF-8. */
export function downloadCsv(fileName: string, rows: unknown[][]) {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Some browsers start the download after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A time for a spreadsheet: local, to the second, and in an order that sorts, such as 2026-10-09 17:33:05. */
export function csvTime(value: string | null | undefined): string {
  if (!value) return ''
  const t = new Date(value)
  if (Number.isNaN(t.getTime())) return value
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
}

/** A file name with today's date, such as devices-2026-10-09.csv. */
export const datedName = (stem: string) => `${stem}-${new Date().toISOString().slice(0, 10)}.csv`

/**
 * Reads CSV text into rows of fields: quoted fields may hold commas, quotes ("") and line breaks; a leading
 * byte order mark and blank lines are dropped. Tabs separate fields instead when the first line has tabs
 * but no commas, as text copied from a spreadsheet does.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '')
  const firstLine = source.split(/\r?\n/, 1)[0] ?? ''
  const separator = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        value += '"'
        i++
      } else if (c === '"') quoted = false
      else value += c
    } else if (c === '"' && value === '') quoted = true
    else if (c === separator) {
      row.push(value)
      value = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++
      row.push(value)
      rows.push(row)
      row = []
      value = ''
    } else value += c
  }
  if (value !== '' || row.length > 0) {
    row.push(value)
    rows.push(row)
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''))
}
