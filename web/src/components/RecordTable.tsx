import { Checkbox, Drawer, Table, Text } from '@mantine/core'
import { useState, type ReactNode } from 'react'
import type { WdsRecord } from '../api/types'
import { formatValue } from '../lib/format'
import { openOnKey } from '../lib/keys'
import { sortRows, type Sort } from '../lib/sort'
import { PropertyList } from './PropertyList'
import { SortableTh } from './SortableTh'

export interface RecordColumn {
  key: string
  label: string
  render?: (row: WdsRecord) => ReactNode
  /** Keep the cell on one line, for short values such as dates and sizes. */
  nowrap?: boolean
  /** What the column sorts by, when not the property named by its key; false if it doesn't sort. */
  sortValue?: ((row: WdsRecord) => unknown) | false
}

/** Rows that can be chosen, for actions on several at once. */
export interface RecordSelection {
  chosen: Set<string>
  onChange: (chosen: Set<string>) => void
  /** Which rows can be chosen; all of them if left out. */
  choosable?: (row: WdsRecord) => boolean
  /** Names a row for screen readers, as in "Choose LAB-PC-01". */
  label: (row: WdsRecord) => string
}

interface RecordTableProps {
  rows: WdsRecord[]
  /**
   * What tells a row's object apart from the others. Rows hold their menus' open dialogs, so a refresh that
   * reorders the list must keep each row with its own object.
   */
  rowKey: (row: WdsRecord) => string
  columns: RecordColumn[]
  empty: string
  detailTitle?: (row: WdsRecord) => string
  selection?: RecordSelection
}

/**
 * A table of WDS objects, sortable by its columns. Clicking a row opens all of its properties in a drawer, so
 * nothing the WDS module reports is hidden behind the column choice.
 */
export function RecordTable({ rows, rowKey, columns, empty, detailTitle, selection }: RecordTableProps) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort | null>(null)

  if (rows.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="xl">
        {empty}
      </Text>
    )
  }

  const sortable = (column: RecordColumn) => column.key !== 'actions' && column.sortValue !== false
  const sortBy = sort ? columns.find((column) => column.key === sort.key && sortable(column)) : undefined
  const shown = sort && sortBy ? sortRows(rows, sortBy.sortValue || ((row) => row[sortBy.key]), sort.descending) : rows
  // The open row follows each refresh, and its drawer closes if the row goes.
  const open = openKey === null ? null : (rows.find((row) => rowKey(row) === openKey) ?? null)

  const choosable = selection ? shown.filter((row) => selection.choosable?.(row) ?? true) : []
  const allChosen = choosable.length > 0 && choosable.every((row) => selection!.chosen.has(rowKey(row)))
  const someChosen = choosable.some((row) => selection!.chosen.has(rowKey(row)))
  const choose = (keys: string[], on: boolean) => {
    const next = new Set(selection!.chosen)
    for (const key of keys) {
      if (on) next.add(key)
      else next.delete(key)
    }
    selection!.onChange(next)
  }

  return (
    <>
      <Table.ScrollContainer minWidth={640}>
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              {selection && (
                <Table.Th w={40}>
                  <Checkbox
                    checked={allChosen}
                    indeterminate={someChosen && !allChosen}
                    disabled={choosable.length === 0}
                    onChange={() => choose(choosable.map(rowKey), !allChosen)}
                    aria-label="Choose all"
                  />
                </Table.Th>
              )}
              {columns.map((column) =>
                sortable(column) ? (
                  <SortableTh key={column.key} label={column.label} sortKey={column.key} sort={sort} onSort={setSort} />
                ) : (
                  <Table.Th key={column.key}>{column.label}</Table.Th>
                ),
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((row) => {
              const key = rowKey(row)
              return (
                <Table.Tr key={key} tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => setOpenKey(key)} onKeyDown={openOnKey(() => setOpenKey(key))}>
                  {selection && (
                    <Table.Td onClick={(event) => event.stopPropagation()}>
                      {(selection.choosable?.(row) ?? true) && (
                        <Checkbox
                          checked={selection.chosen.has(key)}
                          onChange={(event) => choose([key], event.currentTarget.checked)}
                          aria-label={`Choose ${selection.label(row)}`}
                        />
                      )}
                    </Table.Td>
                  )}
                  {columns.map((column) => (
                    <Table.Td key={column.key} style={column.nowrap ? { whiteSpace: 'nowrap' } : undefined}>
                      {column.render ? column.render(row) : formatValue(row[column.key])}
                    </Table.Td>
                  ))}
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Drawer
        opened={open !== null}
        onClose={() => setOpenKey(null)}
        position="right"
        size="lg"
        title={open && detailTitle ? detailTitle(open) : 'Properties'}
      >
        {open && <PropertyList record={open} />}
      </Drawer>
    </>
  )
}
