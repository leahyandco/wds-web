import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconFileImport, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useInstallImages, useRemoveImageGroup } from '../api/queries'
import type { WdsRecord } from '../api/types'
import { EnabledBadge, NameCell, VersionCell } from '../components/Cells'
import { ImageActionsMenu } from '../components/ImageActionsMenu'
import { ImportImageDialog } from '../components/ImportImageDialog'
import { ImportJobs } from '../components/ImportJobs'
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
  { key: 'actions', label: '', render: (row) => <ImageActionsMenu kind="install" image={row} /> },
]

export function InstallImagesPage() {
  const query = useInstallImages()
  const [importing, setImporting] = useState(false)
  const groupNames = query.data?.groups.map((g) => String(g.Name)) ?? []

  return (
    <>
      <PageHeader
        title="Install images"
        description="Windows images the WDS client can install, organised in image groups."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        actions={
          <Button leftSection={<IconFileImport size={16} />} onClick={() => setImporting(true)}>
            Import
          </Button>
        }
      />
      <ImportJobs kind="install" />
      <QueryState query={query}>
        {({ groups, images }) =>
          groups.length === 0 ? (
            <Card withBorder>
              <Text c="dimmed" ta="center" py="lg">
                No image groups yet. Importing an install image creates one.
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
      <ImportImageDialog kind="install" opened={importing} onClose={() => setImporting(false)} groups={groupNames} />
    </>
  )
}

function ImageGroup({ group, images }: { group: WdsRecord; images: WdsRecord[] }) {
  const removeGroup = useRemoveImageGroup()
  const name = String(group.Name)

  const remove = async () => {
    try {
      await removeGroup.mutateAsync(name)
      notifications.show({ color: 'green', message: `Removed image group ${name}` })
    } catch (error) {
      notifications.show({ color: 'red', title: `Couldn't remove ${name}`, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div>
      <Group justify="space-between" mb="xs">
        <Group gap="sm" align="baseline">
          <Title order={4}>{name}</Title>
          <Text size="sm" c="dimmed">
            {plural(images.length, 'image')}
            {typeof group.ImageFormat === 'string' && group.ImageFormat !== 'Unknown' && group.ImageFormat !== 'Empty' ? ` · ${group.ImageFormat}` : ''}
          </Text>
        </Group>
        {images.length === 0 && (
          <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={remove} loading={removeGroup.isPending}>
            Remove empty group
          </Button>
        )}
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
