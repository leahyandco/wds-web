import { Button, Card } from '@mantine/core'
import { IconFileImport } from '@tabler/icons-react'
import { useState } from 'react'
import { useBootImages } from '../api/queries'
import { EnabledBadge, NameCell, VersionCell } from '../components/Cells'
import { ImageActionsMenu } from '../components/ImageActionsMenu'
import { ImportImageDialog } from '../components/ImportImageDialog'
import { ImportJobs } from '../components/ImportJobs'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable, type RecordColumn } from '../components/RecordTable'
import { formatBytes, formatDateTime } from '../lib/format'
import { asNumber, asString, byDisplayOrder, pick } from '../lib/records'

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
  { key: 'actions', label: '', render: (row) => <ImageActionsMenu kind="boot" image={row} /> },
]

export function BootImagesPage() {
  const query = useBootImages()
  const [importing, setImporting] = useState(false)

  return (
    <>
      <PageHeader
        title="Boot images"
        description="WinPE images that PXE clients boot into."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        actions={
          <Button leftSection={<IconFileImport size={16} />} onClick={() => setImporting(true)}>
            Import
          </Button>
        }
      />
      <ImportJobs kind={['boot', 'boot-drivers']} />
      <Card withBorder p={0}>
        <QueryState query={query}>
          {(rows) => (
            <RecordTable
              rows={[...rows].sort(byDisplayOrder)}
              columns={columns}
              empty="No boot images are registered."
              detailTitle={(row) => String(pick(row, 'Name') ?? 'Boot image')}
            />
          )}
        </QueryState>
      </Card>
      <ImportImageDialog kind="boot" opened={importing} onClose={() => setImporting(false)} />
    </>
  )
}
