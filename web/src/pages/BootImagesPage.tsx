import { Card } from '@mantine/core'
import { useBootImages } from '../api/queries'
import { EnabledBadge, NameCell, VersionCell } from '../components/Cells'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable, type RecordColumn } from '../components/RecordTable'
import { formatBytes, formatDateTime } from '../lib/format'
import { asNumber, asString, pick } from '../lib/records'

const columns: RecordColumn[] = [
  { key: 'Name', label: 'Name', render: (row) => <NameCell name={row.Name} description={row.Description} /> },
  { key: 'Version', label: 'Windows', render: (row) => <VersionCell version={row.Version} /> },
  { key: 'Architecture', label: 'Arch', nowrap: true },
  { key: 'FileName', label: 'File' },
  { key: 'Size', label: 'Size', nowrap: true, render: (row) => formatBytes(asNumber(row.Size)) },
  { key: 'Enabled', label: 'Status', render: (row) => <EnabledBadge enabled={row.Enabled} /> },
  {
    key: 'LastModificationTime',
    label: 'Modified',
    nowrap: true,
    render: (row) => formatDateTime(asString(row.LastModificationTime)),
  },
]

export function BootImagesPage() {
  const query = useBootImages()

  return (
    <>
      <PageHeader
        title="Boot images"
        description="WinPE images that PXE clients boot into."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />
      <Card withBorder p={0}>
        <QueryState query={query}>
          {(rows) => (
            <RecordTable
              rows={rows}
              columns={columns}
              empty="No boot images are registered."
              detailTitle={(row) => String(pick(row, 'Name') ?? 'Boot image')}
            />
          )}
        </QueryState>
      </Card>
    </>
  )
}
