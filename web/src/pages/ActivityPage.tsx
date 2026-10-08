import { Alert, Anchor, Badge, Button, Card, Code, Drawer, Group, SegmentedControl, Stack, Table, Text, Timeline, Title } from '@mantine/core'
import { IconAlertTriangle, IconDeviceDesktopPlus, IconInfoCircle } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useActivity, useDevices, useServerConfig } from '../api/queries'
import type { BootSession, Deployment, TftpTransfer, WdsRecord } from '../api/types'
import { BootStatusBadge } from '../components/BootStatusBadge'
import { DeploymentStageBadge } from '../components/DeploymentStageBadge'
import { DeviceEditor } from '../components/DeviceEditor'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { architectureLabel, baseName, bootStatus, clientAddress, imageSeconds } from '../lib/boot'
import { deploymentStage } from '../lib/deployments'
import { EMPTY, formatAgo, formatBytes, formatDateTime } from '../lib/format'
import { findValue, isYes } from '../lib/wdsutil'

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
  const config = useServerConfig()
  const devices = useDevices()
  const clientLogging = config.data ? findValue(config.data.sections, ['WDS Client Policy', 'Logging policy', 'Enabled']) : null
  const serverUnattend = config.data ? isYes(findValue(config.data.sections, ['WDS Client Policy', 'Unattend policy', 'Enabled'])) : false
  const standalone = config.data ? isYes(findValue(config.data.sections, ['Server State', 'Standalone configuration'])) : false
  const unattendExpected = (session: BootSession) => serverUnattend || deviceUnattend(session, devices.data?.prestaged ?? [])

  return (
    <>
      <PageHeader
        title="Boot activity"
        description="PXE boots, boot image downloads and installs, from WDS's event logs. Refreshes every 10 seconds."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />
      <Group mb="md">
        <SegmentedControl data={ranges} value={hours} onChange={setHours} />
      </Group>

      <QueryState query={query}>
        {(activity) => (
          <Stack>
            {clientLogging !== null && !isYes(clientLogging) && (
              <Alert color="blue" icon={<IconInfoCircle />}>
                To follow installs here (which image each machine chose, and how far it got), turn on WDS client logging under{' '}
                <Anchor component={Link} to="/server" inherit>
                  Server settings → WDS client
                </Anchor>
                .
              </Alert>
            )}
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
                <SessionTable sessions={activity.sessions} unattendExpected={unattendExpected} onSelect={setSelected} />
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
        {selected && (
          <SessionDetail
            session={selected}
            unattendExpected={unattendExpected(selected)}
            standalone={standalone}
            onPrestage={() => setPrestaging(selected)}
          />
        )}
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

/** Whether the client's prestaged device has its own WDS client unattend file. */
function deviceUnattend(session: BootSession, devices: WdsRecord[]) {
  const hex = (value: unknown) => String(value ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase()
  const ids = [session.macAddress, session.deviceId].map(hex).filter(Boolean)
  return devices.some((device) => ids.includes(hex(device.DeviceID)) && String(device.WdsClientUnattend ?? '').trim() !== '')
}

interface SessionTableProps {
  sessions: BootSession[]
  /** Whether WDS would have given the client an unattend file; if not, refusing to changes nothing. */
  unattendExpected: (session: BootSession) => boolean
  onSelect: (session: BootSession) => void
}

function SessionTable({ sessions, unattendExpected, onSelect }: SessionTableProps) {
  return (
    <Table.ScrollContainer minWidth={860}>
      <Table striped highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>When</Table.Th>
            <Table.Th>Client</Table.Th>
            <Table.Th>Arch</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Boot image</Table.Th>
            <Table.Th>Install</Table.Th>
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
                    {clientAddress(session)}
                  </Text>
                </Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  <Text size="sm">{architectureLabel(session)}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    <BootStatusBadge status={session.status} />
                    {session.notes.some((note) => note.kind === 'unattendBlocked') && unattendExpected(session) && (
                      <Badge color="orange" variant="light" tt="none">
                        Unattend refused
                      </Badge>
                    )}
                    {session.notes.some((note) => note.kind === 'notRecognized') && (
                      <Badge color="orange" variant="light" tt="none">
                        Not prestaged
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  <Text size="sm">{session.bootImage ? baseName(session.bootImage) : EMPTY}</Text>
                  {(seconds != null || image?.fileSize) && (
                    <Text size="xs" c="dimmed">
                      {[seconds != null ? `${seconds.toFixed(0)} s` : null, image?.fileSize ? formatBytes(image.fileSize) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {session.deployment ? (
                    <Stack gap={2} align="flex-start">
                      <DeploymentStageBadge stage={session.deployment.stage} />
                      {session.deployment.imageName && (
                        <Text size="xs" c="dimmed">
                          {session.deployment.imageName}
                        </Text>
                      )}
                    </Stack>
                  ) : (
                    <Text size="sm">{EMPTY}</Text>
                  )}
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

interface SessionDetailProps {
  session: BootSession
  unattendExpected: boolean
  /** A standalone WDS server has no domain to join devices to. */
  standalone: boolean
  onPrestage: () => void
}

function SessionDetail({ session, unattendExpected, standalone, onPrestage }: SessionDetailProps) {
  const facts: [string, string][] = [
    ['MAC address', session.macAddress ?? EMPTY],
    ['IP address', clientAddress(session)],
    ['Device ID', session.deviceId ?? EMPTY],
    ['Architecture', architectureLabel(session)],
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
      {unattendExpected &&
        session.notes
          .filter((note) => note.kind === 'unattendBlocked')
          .map((note) => (
            <Alert key={note.time} color="orange" icon={<IconAlertTriangle />} title="WDS refused the unattend request">
              At {formatDateTime(note.time)} Windows Setup asked for the WDS client unattend file, and WDS refused: hands-free
              deployment has been off since the April 2026 update (CVE-2026-0386). So the WDS client asked its questions
              (language, sign-in, which image) at the machine instead of taking the answers from the file.
            </Alert>
          ))}
      {session.notes.some((note) => note.kind === 'notRecognized') && (
        <Alert color="orange" icon={<IconAlertTriangle />} title="WDS ignored this client">
          It isn't prestaged, and WDS answers only known clients. Prestage it below, or let WDS answer all clients under{' '}
          <Anchor component={Link} to="/server" inherit>
            Server settings → PXE response
          </Anchor>
          .
        </Alert>
      )}
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
      {!unattendExpected && session.notes.some((note) => note.kind === 'unattendBlocked') && (
        <Text size="xs" c="dimmed" mt="-sm">
          Windows Setup asked WDS for an unattend file, which WDS refuses since the April 2026 update (CVE-2026-0386). That
          makes no difference here: WDS has no unattend file to give this client.
        </Text>
      )}

      {session.deployment && <DeploymentDetail deployment={session.deployment} standalone={standalone} />}

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

/** The install as the WDS client reported it: what it chose, how long each part took, and what happened. */
function DeploymentDetail({ deployment, standalone }: { deployment: Deployment; standalone: boolean }) {
  const active = deployment.stage !== 'finished' && deployment.stage !== 'failed'
  // How long a step took, or for one still going, when it started.
  const took = (from: string | null, to: string | null) =>
    from && to
      ? formatMinutes((new Date(to).getTime() - new Date(from).getTime()) / 1000)
      : from && active
        ? `Started ${formatAgo(from)}`
        : null
  const download = took(deployment.transferStartedAt, deployment.transferFinishedAt)
  const apply = took(deployment.applyStartedAt, deployment.applyFinishedAt)
  const facts: [string, string][] = [
    ['Image', deployment.imageName ? `${deployment.imageName}${deployment.imageGroup ? ` (${deployment.imageGroup})` : ''}` : EMPTY],
    ...(deployment.userName ? ([['Signed in as', deployment.userName]] as [string, string][]) : []),
    [
      'Download',
      download
        ? `${download}${deployment.multicastNamespace ? ', by multicast' : ''}`
        : deployment.unicast
          ? 'None: installed straight from the server, with no multicast'
          : EMPTY,
    ],
    ['Apply', apply ?? EMPTY],
    ['Last heard from', `${formatDateTime(deployment.lastSeen)} (${formatAgo(deployment.lastSeen)})`],
  ]

  return (
    <div>
      <Group gap="sm" mb="xs">
        <Title order={5}>Install</Title>
        <DeploymentStageBadge stage={deployment.stage} />
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        {deploymentStage[deployment.stage].description}
      </Text>
      {deployment.error && (
        <Alert color="red" icon={<IconAlertTriangle />} mb="sm">
          {deployment.error}
          {deployment.domainJoinFailed && standalone && (
            <Text size="sm" mt={4}>
              This WDS server is standalone, so there's no domain to join. Turn off <i>Join the domain during setup</i> for the
              device under{' '}
              <Anchor component={Link} to="/devices" inherit>
                Devices
              </Anchor>
              .
            </Text>
          )}
        </Alert>
      )}
      <Table withRowBorders={false} verticalSpacing={4} mb="md">
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
      <Timeline bulletSize={12} lineWidth={2} active={deployment.timeline.length - 1}>
        {deployment.timeline.map((note, index) => (
          <Timeline.Item key={index} color={note.level === 'error' ? 'red' : note.level === 'warning' ? 'orange' : 'blue'} title={note.text}>
            <Text size="xs" c="dimmed">
              {formatDateTime(note.time)}
            </Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </div>
  )
}

function formatMinutes(seconds: number) {
  if (seconds < 90) return `${Math.round(seconds)} s`
  return `${Math.round(seconds / 60)} min`
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
