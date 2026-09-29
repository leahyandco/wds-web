import { Card, Stack, Title } from '@mantine/core'
import { useInstallImages } from '../api/queries'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable } from '../components/RecordTable'
import { autoColumns, pick } from '../lib/records'

const groupColumns = ['Name', 'Path']
const imageColumns = ['ImageName', 'Name', 'ImageGroup', 'Architecture', 'Version', 'Edition', 'Enabled', 'FileName', 'Size']

export function InstallImagesPage() {
  const query = useInstallImages()

  return (
    <>
      <PageHeader
        title="Install images"
        description="Windows images the WDS client can install, organised in image groups."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />
      <QueryState query={query}>
        {({ groups, images }) => (
          <Stack gap="lg">
            <div>
              <Title order={4} mb="xs">
                Image groups
              </Title>
              <Card withBorder p={0}>
                <RecordTable
                  rows={groups}
                  columns={autoColumns(groups, groupColumns)}
                  empty="No image groups."
                  detailTitle={(row) => String(pick(row, 'Name') ?? 'Image group')}
                />
              </Card>
            </div>
            <div>
              <Title order={4} mb="xs">
                Images
              </Title>
              <Card withBorder p={0}>
                <RecordTable
                  rows={images}
                  columns={autoColumns(images, imageColumns)}
                  empty="No install images."
                  detailTitle={(row) => String(pick(row, 'ImageName', 'Name') ?? 'Install image')}
                />
              </Card>
            </div>
          </Stack>
        )}
      </QueryState>
    </>
  )
}
