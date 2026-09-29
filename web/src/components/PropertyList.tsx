import { Table, Text } from '@mantine/core'
import type { WdsRecord } from '../api/types'
import { formatValue } from '../lib/format'

/** Every property of a WDS object, including ones no table column shows. */
export function PropertyList({ record }: { record: WdsRecord }) {
  return (
    <Table withRowBorders={false} verticalSpacing={4} layout="fixed">
      <Table.Tbody>
        {Object.entries(record).map(([key, value]) => (
          <Table.Tr key={key}>
            <Table.Td w="40%" style={{ verticalAlign: 'top' }}>
              <Text size="sm" c="dimmed">
                {key}
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {value !== null && typeof value === 'object' && !Array.isArray(value)
                  ? JSON.stringify(value, null, 2)
                  : formatValue(value)}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}
