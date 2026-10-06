import { Alert, Badge, Button, Card, Code, Drawer, Group, SegmentedControl, Stack, Table, Text, Title } from '@mantine/core'
import { IconDeviceDesktopPlus, IconInfoCircle } from '@tabler/icons-react'
import { useState } from 'react'
import { useActivity } from '../api/queries'
import type { BootSession, TftpTransfer } from '../api/types'
import { BootStatusBadge } from '../components/BootStatusBadge'
import { DeviceEditor } from '../components/DeviceEditor'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { architectureLabel, baseName, bootStatus, imageSeconds } from '../lib/boot'
import { EMPTY, formatAgo, formatBytes, formatDateTime } from '../lib/format'

const ranges = [
  { label: '24 hours', value: '24' },
  { label: '3 days', value: '72' },
  { label: '7 days', value: '168' },
]

export function ActivityPage() {
  const [hours, setHours] = useState('72')
  const [selected, setSelected] = useState<BootSession | null>(null)
  const [prestaging, setPrestaging] = useState<BootSession | null>(null)
  const query = useActivity(Number(hours))

  return (
    <>
      <PageHeader
        title="Boot activity"
        description="PXE boots and boot image downloads, from WDS's event log. Refreshes every 10 seconds."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />
      <Group mb="md">
        <SegmentedControl data={ranges} value={hours} onChange={setHours} />
      </Group>

      <QueryState query={query}>
        {(activity) => (
          <Stack>
            {activity.logStartsAt && (
              <Alert color="blue" icon={<IconInfoCircle />}>
                WDS keeps only {formatBytes(activity.logMaxBytes)} of these events, which currently reaches back to{' '}
                {formatDateTime(activity.logStartsAt)}. Earlier boots aren't recorded anywhere.
              </Alert>
            )}
            <Card withBorder p={0}>
              {activity.sessions.length === 0 ? (
                <Text c="dimmed" ta="center" py="xl">
                  No PXE boots in this period.
                </Text>
              ) : (
                <SessionTable sessions={activity.sessions} onSelect={setSelected} />
              )}
            </Card>
          </Stack>
        )}
      </QueryState>

      <Drawer
        opened={selected !== null}
        onClose={() => setSelected(null)}
        position="right"
        size="xl"
        title={selected ? `Boot from ${selected.macAddress ?? selected.clientIp}` : undefined}
      >
        {selected && <SessionDetail session={selected} onPrestage={() => setPrestaging(selected)} />}
      </Drawer>
      <DeviceEditor
        opened={prestaging !== null}
        device={null}
        seed={prestaging ? { guid: prestaging.deviceId, mac: prestaging.macAddress } : undefined}
        onClose={() => setPrestaging(null)}
      />
    </>
  )
}

function SessionTable({ sessions, onSelect }: { sessions: BootSession[]; onSelect: (session: BootSession) => void }) {
  return (
    <Table.ScrollContainer minWidth={820}>
      <Table striped highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>When</Table.Th>
            <Table.Th>Client</Table.Th>
            <Table.Th>Arch</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Boot image</Table.Th>
            <Table.Th>Download</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sessions.map((session) => {
            const seconds = imageSeconds(session)
            const image = session.transfers.findLast((t) => t.fileName === session.bootImage)
            return (
              <Table.Tr
                key={`${session.clientIp}-${session.firstSeen}`}
                tabIndex={0}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(session)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(session)}
              >
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  <Text size="sm">{formatDateTime(session.firstSeen)}</Text>
                  <Text size="xs" c="dimmed">
                    {formatAgo(session.lastSeen)}
                  </Text>
                </Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  <Text size="sm" ff="monospace">
                    {session.macAddress ?? 'Unknown MAC'}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {session.clientIp}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{architectureLabel(session)}</Text>
                </Table.Td>
                <Table.Td>
                  <BootStatusBadge status={session.status} />
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{session.bootImage ? baseName(session.bootImage) : EMPTY}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">
                    {seconds != null ? `${seconds.toFixed(0)} s` : EMPTY}
                    {image?.fileSize ? ` · ${formatBytes(image.fileSize)}` : ''}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function SessionDetail({ session, onPrestage }: { session: BootSession; onPrestage: () => void }) {
  const facts: [string, string][] = [
    ['MAC address', session.macAddress ?? EMPTY],
    ['IP address', session.clientIp],
    ['Device ID', session.deviceId ?? EMPTY],
    [
      'Architecture',
      session.architecture
        ? `${session.architecture}${session.architectureCode != null ? ` (PXE code ${session.architectureCode})` : ''}`
        : architectureLabel(session),
    ],
    ['Prestaged', session.prestaged == null ? EMPTY : session.prestaged ? 'Yes' : 'No'],
    ['First seen', formatDateTime(session.firstSeen)],
    ['Last seen', formatDateTime(session.lastSeen)],
  ]

  return (
    <Stack gap="lg">
      <Group gap="sm">
        <BootStatusBadge status={session.status} />
        <Text size="sm" c="dimmed">
          {bootStatus[session.status].description}
        </Text>
      </Group>
      {session.prestaged !== true && (session.deviceId || session.macAddress) && (
        <Group>
          <Button variant="light" leftSection={<IconDeviceDesktopPlus size={16} />} onClick={onPrestage}>
            Prestage this device
          </Button>
        </Group>
      )}
      <Table withRowBorders={false} verticalSpacing={4}>
        <Table.Tbody>
          {facts.map(([label, value]) => (
            <Table.Tr key={label}>
              <Table.Td w={160}>
                <Text size="sm" c="dimmed">
                  {label}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{value}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <div>
        <Title order={5} mb="xs">
          TFTP downloads
        </Title>
        {session.transfers.length === 0 ? (
          <Text size="sm" c="dimmed">
            None. The client made a PXE request but didn't download a boot program.
          </Text>
        ) : (
          <TransferTable transfers={session.transfers} />
        )}
      </div>
    </Stack>
  )
}

function TransferTable({ transfers }: { transfers: TftpTransfer[] }) {
  return (
    <Table verticalSpacing={6}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>File</Table.Th>
          <Table.Th>Size</Table.Th>
          <Table.Th>Took</Table.Th>
          <Table.Th>Result</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {transfers.map((transfer, index) => {
          const took =
            transfer.startedAt && transfer.finishedAt
              ? `${((new Date(transfer.finishedAt).getTime() - new Date(transfer.startedAt).getTime()) / 1000).toFixed(0)} s`
              : EMPTY
          return (
            <Table.Tr key={index}>
              <Table.Td>
                <Code>{transfer.fileName}</Code>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{formatBytes(transfer.fileSize)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{took}</Text>
              </Table.Td>
              <Table.Td>
                {transfer.succeeded === true && (
                  <Badge color="green" variant="light" tt="none">
                    Done
                  </Badge>
                )}
                {transfer.succeeded === false && (
                  <Badge color="red" variant="light" tt="none">
                    Failed{transfer.errorCode ? ` (${transfer.errorCode})` : ''}
                  </Badge>
                )}
                {transfer.succeeded == null && (
                  <Badge color="gray" variant="light" tt="none">
                    No end logged
                  </Badge>
                )}
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
  )
}
