import { Group, Table, UnstyledButton, type TableThProps } from '@mantine/core'
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react'
import type { Sort } from '../lib/sort'

interface SortableThProps extends TableThProps {
  label: string
  sortKey: string
  sort: Sort | null
  onSort: (sort: Sort) => void
}

/** A column heading that sorts its table: the first click ascending, the next descending. */
export function SortableTh({ label, sortKey, sort, onSort, ...props }: SortableThProps) {
  const active = sort?.key === sortKey
  const descending = active && sort.descending
  const Icon = active ? (descending ? IconChevronDown : IconChevronUp) : IconSelector
  return (
    <Table.Th aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'} {...props}>
      <UnstyledButton
        onClick={() => onSort({ key: sortKey, descending: active ? !descending : false })}
        style={{ font: 'inherit', fontWeight: 'inherit', whiteSpace: 'nowrap' }}
      >
        <Group gap={4} wrap="nowrap">
          {label}
          <Icon size={14} stroke={1.8} style={{ opacity: active ? 1 : 0.4 }} aria-hidden />
        </Group>
      </UnstyledButton>
    </Table.Th>
  )
}
