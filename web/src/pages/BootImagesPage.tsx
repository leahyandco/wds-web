import { Card } from '@mantine/core'
import { useBootImages } from '../api/queries'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable } from '../components/RecordTable'
import { autoColumns, pick } from '../lib/records'

const preferredColumns = ['Name', 'ImageName', 'Architecture', 'Version', 'Description', 'Enabled', 'FileName', 'Size']

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
              columns={autoColumns(rows, preferredColumns)}
              empty="No boot images are registered."
              detailTitle={(row) => String(pick(row, 'Name', 'ImageName') ?? 'Boot image')}
            />
          )}
        </QueryState>
      </Card>
    </>
  )
}
