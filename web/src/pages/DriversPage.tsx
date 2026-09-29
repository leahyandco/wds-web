import { Badge, Card } from '@mantine/core'
import { useDrivers } from '../api/queries'
import { EnabledBadge, NameCell } from '../components/Cells'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable, type RecordColumn } from '../components/RecordTable'
import { formatDate, formatDateTime } from '../lib/format'
import { asString, pick } from '../lib/records'

const columns: RecordColumn[] = [
  { key: 'Name', label: 'Package', render: (row) => <NameCell name={row.Name} description={row.provider} /> },
  { key: 'ClassName', label: 'Class' },
  { key: 'Architecture', label: 'Arch', nowrap: true },
  { key: 'Version', label: 'Version', nowrap: true },
  { key: 'Date', label: 'Driver date', nowrap: true, render: (row) => formatDate(asString(row.Date)) },
  {
    key: 'Drivers',
    label: 'Drivers',
    render: (row) => (Array.isArray(row.Drivers) ? row.Drivers.length : 0),
  },
  {
    key: 'SignatureValid',
    label: 'Signature',
    render: (row) =>
      row.SignatureValid === true ? (
        <Badge color="green" variant="light" tt="none">
          Valid
        </Badge>
      ) : (
        <Badge color="red" variant="light" tt="none">
          Invalid
        </Badge>
      ),
  },
  { key: 'Enabled', label: 'Status', render: (row) => <EnabledBadge enabled={row.Enabled} /> },
  { key: 'DateAdded', label: 'Added', nowrap: true, render: (row) => formatDateTime(asString(row.DateAdded)) },
]

export function DriversPage() {
  const query = useDrivers()

  return (
    <>
      <PageHeader
        title="Drivers"
        description="Driver packages in the WDS driver store, for injecting into boot images or installs."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />
      <Card withBorder p={0}>
        <QueryState query={query}>
          {(rows) => (
            <RecordTable
              rows={rows}
              columns={columns}
              empty="The driver store is empty."
              detailTitle={(row) => String(pick(row, 'Name') ?? 'Driver package')}
            />
          )}
        </QueryState>
      </Card>
    </>
  )
}
