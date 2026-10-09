import { ActionIcon, Badge, Card, Group, Loader, Stack, Table, Text, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconTrash } from '@tabler/icons-react'
import { useDeleteUpload, useJobs, useUploads } from '../api/queries'
import type { UploadInfo } from '../api/types'
import { formatAgo, formatBytes } from '../lib/format'
import { isActive } from '../lib/jobs'

/**
 * Files uploaded into the staging folder that are still there: imports keep theirs unless asked to delete
 * them, and an upload that stopped halfway waits to be resumed. Each one takes space on the WDS server.
 */
export function StagedUploadsCard() {
  const uploads = useUploads()
  const jobs = useJobs()
  const remove = useDeleteUpload()
  // Uploads a queued or running import still needs.
  const inUse = new Set((jobs.data ?? []).filter(isActive).map((job) => ('uploadId' in job.request ? job.request.uploadId : null)))
  const files = uploads.data ?? []
  const total = files.reduce((sum, upload) => sum + upload.received, 0)

  const deleteUpload = async (upload: UploadInfo) => {
    const ask = upload.complete
      ? `Delete ${upload.fileName} from the staging folder?`
      : `Delete the ${formatBytes(upload.received)} of ${upload.fileName} uploaded so far? Uploading it again would start over.`
    if (!window.confirm(ask)) return
    try {
      await remove.mutateAsync(upload.id)
      notifications.show({ color: 'green', message: `Deleted ${upload.fileName}` })
    } catch (error) {
      notifications.show({ color: 'red', title: `Couldn't delete ${upload.fileName}`, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <Card withBorder padding="md">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Uploads in the staging folder</Text>
        {files.length > 0 && (
          <Text size="sm" c="dimmed">
            {formatBytes(total)} in all
          </Text>
        )}
      </Group>
      {uploads.isPending ? (
        <Loader size="sm" />
      ) : uploads.error ? (
        <Text size="sm" c="red">
          {uploads.error.message}
        </Text>
      ) : files.length === 0 ? (
        <Text size="sm" c="dimmed">
          None. Imports from an upload can delete it once they're done.
        </Text>
      ) : (
        <Stack gap={4}>
          <Table verticalSpacing={4}>
            <Table.Tbody>
              {files.map((upload) => (
                <Table.Tr key={upload.id}>
                  <Table.Td>
                    <Text size="sm" style={{ wordBreak: 'break-all' }}>
                      {upload.fileName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Uploaded {formatAgo(upload.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Text size="sm">{upload.complete ? formatBytes(upload.size) : `${formatBytes(upload.received)} of ${formatBytes(upload.size)}`}</Text>
                  </Table.Td>
                  <Table.Td>
                    {!upload.complete && (
                      <Badge size="sm" variant="light" color="yellow" tt="none">
                        Unfinished
                      </Badge>
                    )}
                    {inUse.has(upload.id) && (
                      <Badge size="sm" variant="light" tt="none">
                        An import needs it
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td w={40}>
                    <Tooltip label={inUse.has(upload.id) ? 'An import still needs it' : 'Delete it'}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Delete ${upload.fileName}`}
                        disabled={inUse.has(upload.id)}
                        loading={remove.isPending && remove.variables === upload.id}
                        onClick={() => void deleteUpload(upload)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Card>
  )
}
