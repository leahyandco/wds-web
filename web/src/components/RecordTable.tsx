import { Drawer, Table, Text } from '@mantine/core'
import { useState, type ReactNode } from 'react'
import type { WdsRecord } from '../api/types'
import { formatValue } from '../lib/format'
import { PropertyList } from './PropertyList'

export interface RecordColumn {
  key: string
  label: string
  render?: (row: WdsRecord) => ReactNode
  /** Keep the cell on one line, for short values such as dates and sizes. */
  nowrap?: boolean
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
}

/**
 * A table of WDS objects. Clicking a row opens all of its properties in a drawer, so nothing the WDS
 * module reports is hidden behind the column choice.
 */
export function RecordTable({ rows, rowKey, columns, empty, detailTitle }: RecordTableProps) {
  const [selected, setSelected] = useState<WdsRecord | null>(null)

  if (rows.length === 0) {
    return (
      <Text c="dimmed" ta="center" py="xl">
        {empty}
      </Text>
    )
  }

  return (
    <>
      <Table.ScrollContainer minWidth={640}>
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              {columns.map((column) => (
                <Table.Th key={column.key}>{column.label}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr
                key={rowKey(row)}
                tabIndex={0}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(row)}
                onKeyDown={(event) => event.key === 'Enter' && setSelected(row)}
              >
                {columns.map((column) => (
                  <Table.Td key={column.key} style={column.nowrap ? { whiteSpace: 'nowrap' } : undefined}>
                    {column.render ? column.render(row) : formatValue(row[column.key])}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Drawer
        opened={selected !== null}
        onClose={() => setSelected(null)}
        position="right"
        size="lg"
        title={selected && detailTitle ? detailTitle(selected) : 'Properties'}
      >
        {selected && <PropertyList record={selected} />}
      </Drawer>
    </>
  )
}
