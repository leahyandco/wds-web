import { Badge, Card, Group, Stack, Text, Title } from '@mantine/core'
import { useInstallImages } from '../api/queries'
import type { WdsRecord } from '../api/types'
import { EnabledBadge, NameCell, VersionCell } from '../components/Cells'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable, type RecordColumn } from '../components/RecordTable'
import { formatBytes, formatDateTime, plural } from '../lib/format'
import { asNumber, asString, pick } from '../lib/records'

const columns: RecordColumn[] = [
  { key: 'Name', label: 'Name', render: (row) => <NameCell name={row.Name} description={row.Description} /> },
  { key: 'Version', label: 'Windows', render: (row) => <VersionCell version={row.Version} /> },
  { key: 'Architecture', label: 'Arch', nowrap: true },
  { key: 'FileName', label: 'File' },
  { key: 'Size', label: 'Size', nowrap: true, render: (row) => formatBytes(asNumber(row.Size)) },
  {
    key: 'UnattendFilePresent',
    label: 'Unattend',
    render: (row) =>
      row.UnattendFilePresent === true ? (
        <Badge variant="light" tt="none">
          Attached
        </Badge>
      ) : (
        <Text size="sm" c="dimmed">
          None
        </Text>
      ),
  },
  { key: 'Enabled', label: 'Status', render: (row) => <EnabledBadge enabled={row.Enabled} /> },
  {
    key: 'LastModificationTime',
    label: 'Modified',
    nowrap: true,
    render: (row) => formatDateTime(asString(row.LastModificationTime)),
  },
]

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
        {({ groups, images }) =>
          groups.length === 0 ? (
            <Card withBorder>
              <Text c="dimmed" ta="center" py="lg">
                No image groups.
              </Text>
            </Card>
          ) : (
            <Stack gap="xl">
              {groups.map((group) => (
                <ImageGroup key={String(group.Name)} group={group} images={images.filter((i) => i.ImageGroup === group.Name)} />
              ))}
            </Stack>
          )
        }
      </QueryState>
    </>
  )
}

function ImageGroup({ group, images }: { group: WdsRecord; images: WdsRecord[] }) {
  return (
    <div>
      <Group gap="sm" mb="xs" align="baseline">
        <Title order={4}>{String(group.Name)}</Title>
        <Text size="sm" c="dimmed">
          {plural(images.length, 'image')}
          {typeof group.ImageFormat === 'string' && group.ImageFormat !== 'Unknown' ? ` · ${group.ImageFormat}` : ''}
        </Text>
      </Group>
      <Card withBorder p={0}>
        <RecordTable
          rows={images}
          columns={columns}
          empty="This group is empty."
          detailTitle={(row) => String(pick(row, 'Name') ?? 'Install image')}
        />
      </Card>
    </div>
  )
}
