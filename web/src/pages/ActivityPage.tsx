import { Alert, Anchor, Badge, Button, Card, Code, Drawer, Group, SegmentedControl, Stack, Table, Text, TextInput, Timeline, Title } from '@mantine/core'
import { IconAlertTriangle, IconDeviceDesktopPlus, IconDownload, IconInfoCircle, IconSearch } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useActivity, useBootImages, useDevices, useServerConfig } from '../api/queries'
import type { BootSession, Deployment, TftpTransfer, WdsRecord } from '../api/types'
import { BootStatusBadge } from '../components/BootStatusBadge'
import { CopyValue } from '../components/Copy'
import { DeploymentStageBadge } from '../components/DeploymentStageBadge'
import { DeviceEditor } from '../components/DeviceEditor'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { architectureLabel, bootStatus, clientAddress, imageSeconds } from '../lib/boot'
import { csvTime, datedName, downloadCsv } from '../lib/csv'
import { deploymentStage } from '../lib/deployments'
import { bootImageName, prestagedDevice } from '../lib/devices'
import { EMPTY, formatAgo, formatBytes, formatDateTime, formatDateTimeSeconds } from '../lib/format'
import { useUrlParams } from '../lib/urlState'
import { findValue, isYes } from '../lib/wdsutil'
import { openOnKey } from '../lib/keys'

const ranges = [
  { label: '24 hours', value: '24' },
  { label: '3 days', value: '72' },
  { label: '7 days', value: '168' },
]
const DEFAULT_RANGE = '72'

/** What the page knows about a boot beyond the boot itself, from the device and boot image lists. */
interface BootNames {
  /** The prestaged device the client is now, if it is one. */
  device: (session: BootSession) => WdsRecord | undefined
  /** The boot image's name in WDS, or its file name if WDS no longer has it. */
  image: (session: BootSession) => string | null
}

const hexOnly = (value: string | null | undefined) => (value ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase()

/** Whether a boot matches a search, by any of what the table shows; a MAC address matches with any separators. */
function matches(session: BootSession, names: BootNames, needle: string) {
  const device = names.device(session)
  const texts = [
    session.macAddress,
    session.clientIp,
    session.deviceId,
    session.architecture,
    device ? String(device.DeviceName) : null,
    names.image(session),
    session.bootImage,
    bootStatus[session.status].label,
    session.deployment ? deploymentStage[session.deployment.stage].label : null,
    session.deployment?.imageName,
    session.deployment?.userName,
    session.notes.some((note) => note.kind === 'notRecognized') ? 'Not prestaged' : null,
    session.notes.some((note) => note.kind === 'unattendBlocked') ? 'Unattend refused' : null,
  ]
  const digits = needle.replace(/[-:. ]/g, '')
  return (
    texts.some((text) => text?.toLowerCase().includes(needle)) ||
    (/^[0-9a-f]{4,}$/.test(digits) && hexOnly(session.macAddress).includes(digits))
  )
}

export function ActivityPage() {
  // The range, the search and the open boot are in the address, so they survive a reload and other pages can
  // link to a boot.
  const [params, update] = useUrlParams()
  const hours = params.get('range') ?? DEFAULT_RANGE
  const bootId = params.get('boot')
  // The box keeps its own text, as the address updates a moment later; reading it back would drop keystrokes.
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  const [prestaging, setPrestaging] = useState<BootSession | null>(null)
  const query = useActivity(Number(hours))
  const config = useServerConfig()
  const devices = useDevices()
  const bootImages = useBootImages()
  const clientLogging = config.data ? findValue(config.data.sections, ['WDS Client Policy', 'Logging policy', 'Enabled']) : null
  const serverUnattend = config.data ? isYes(findValue(config.data.sections, ['WDS Client Policy', 'Unattend policy', 'Enabled'])) : false
  const standalone = config.data ? isYes(findValue(config.data.sections, ['Server State', 'Standalone configuration'])) : false

  const names: BootNames = {
    device: (session) => prestagedDevice(devices.data?.prestaged ?? [], session.macAddress, session.deviceId),
    image: (session) => (session.bootImage ? bootImageName(bootImages.data ?? [], session.bootImage) : null),
  }
  // Whether WDS would have given the client an unattend file: the server's, or its prestaged device's own.
  const unattendExpected = (session: BootSession) =>
    serverUnattend || String(names.device(session)?.WdsClientUnattend ?? '').trim() !== ''

  // The open boot follows each refresh, so an install being watched moves on. If a refresh no longer has the
  // boot (after choosing a shorter range, say), the last copy stays open.
  const found = bootId ? query.data?.sessions.find((session) => session.id === bootId) : undefined
  const [kept, setKept] = useState<BootSession | null>(null)
  if (found && found !== kept) setKept(found)
  const selected = found ?? (kept && kept.id === bootId ? kept : null)
  const selectedDevice = selected ? names.device(selected) : undefined

  const needle = search.trim().toLowerCase()
  const visible = (query.data?.sessions ?? []).filter((session) => !needle || matches(session, names, needle))

  /** The boots shown, as filtered, as a CSV file. */
  const exportCsv = () =>
    downloadCsv(datedName('boot-activity'), [
      ['Started', 'Last seen', 'Device', 'MAC address', 'IP address', 'Device ID', 'Architecture', 'Status', 'Boot image', 'Download seconds', 'Install', 'Install image', 'Signed in as', 'Error'],
      ...visible.map((session) => {
        const seconds = imageSeconds(session)
        return [
          csvTime(session.firstSeen),
          csvTime(session.lastSeen),
          names.device(session)?.DeviceName,
          session.macAddress,
          session.clientIp,
          session.deviceId,
          session.architecture,
          bootStatus[session.status].label,
          names.image(session),
          seconds != null ? Math.round(seconds) : '',
          session.deployment ? deploymentStage[session.deployment.stage].label : '',
          session.deployment?.imageName,
          session.deployment?.userName,
          session.deployment?.error,
        ]
      }),
    ])

  return (
    <>
      <PageHeader
        title="Boot activity"
        description="PXE boots, boot image downloads and installs, from WDS's event logs. Refreshes every 10 seconds."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        actions={
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={exportCsv} disabled={visible.length === 0}>
            Export CSV
          </Button>
        }
      />
      <Group mb="md" gap="sm">
        <SegmentedControl data={ranges} value={hours} onChange={(value) => update({ range: value === DEFAULT_RANGE ? null : value })} />
        <TextInput
          placeholder="Search MAC, IP, name, image or status"
          aria-label="Search boots"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value)
            update({ q: event.currentTarget.value })
          }}
          style={{ flex: 1, minWidth: 220 }}
        />
      </Group>

      <QueryState query={query}>
        {(activity) => {
          return (
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
                {visible.length === 0 ? (
                  <Text c="dimmed" ta="center" py="xl">
                    {activity.sessions.length === 0 ? 'No PXE boots in this period.' : 'No boots match.'}
                  </Text>
                ) : (
                  <SessionTable
                    sessions={visible}
                    names={names}
                    unattendExpected={unattendExpected}
                    onSelect={(session) => update({ boot: session.id })}
                  />
                )}
              </Card>
            </Stack>
          )
        }}
      </QueryState>

      <Drawer
        opened={selected !== null}
        onClose={() => update({ boot: null })}
        position="right"
        size="xl"
        title={selected ? `Boot from ${selectedDevice ? String(selectedDevice.DeviceName) : (selected.macAddress ?? selected.clientIp)}` : undefined}
      >
        {selected && (
          <SessionDetail
            session={selected}
            device={selectedDevice}
            imageName={names.image(selected)}
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

interface SessionTableProps {
  sessions: BootSession[]
  names: BootNames
  /** Whether WDS would have given the client an unattend file; if not, refusing to changes nothing. */
  unattendExpected: (session: BootSession) => boolean
  onSelect: (session: BootSession) => void
}

function SessionTable({ sessions, names, unattendExpected, onSelect }: SessionTableProps) {
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
            const device = names.device(session)
            return (
              <Table.Tr
                key={session.id}
                tabIndex={0}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(session)}
                onKeyDown={openOnKey(() => onSelect(session))}
              >
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  <Text size="sm">{formatDateTime(session.firstSeen)}</Text>
                  <Text size="xs" c="dimmed">
                    {formatAgo(session.lastSeen)}
                  </Text>
                </Table.Td>
                <Table.Td style={{ whiteSpace: 'nowrap' }}>
                  {device ? (
                    <>
                      <Text size="sm" fw={500}>
                        {String(device.DeviceName)}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {[session.macAddress, clientAddress(session)].filter(Boolean).join(' · ')}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text size="sm" ff="monospace">
                        {session.macAddress ?? 'Unknown MAC'}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {clientAddress(session)}
                      </Text>
                    </>
                  )}
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
                  <Text size="sm">{names.image(session) ?? EMPTY}</Text>
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
  /** The prestaged device the client is now, if it is one. */
  device: WdsRecord | undefined
  imageName: string | null
  unattendExpected: boolean
  /** A standalone WDS server has no domain to join devices to. */
  standalone: boolean
  onPrestage: () => void
}

function SessionDetail({ session, device, imageName, unattendExpected, standalone, onPrestage }: SessionDetailProps) {
  const facts: { label: string; value: ReactNode }[] = [
    ...(device ? [{ label: 'Device', value: String(device.DeviceName) }] : []),
    {
      label: 'MAC address',
      value: session.macAddress ? <CopyValue value={session.macAddress} label="Copy the MAC address" monospace /> : EMPTY,
    },
    {
      label: 'IP address',
      value: session.clientIp === '0.0.0.0' ? clientAddress(session) : <CopyValue value={session.clientIp} label="Copy the IP address" />,
    },
    { label: 'Device ID', value: session.deviceId ? <CopyValue value={session.deviceId} label="Copy the device ID" monospace /> : EMPTY },
    { label: 'Architecture', value: architectureLabel(session) },
    { label: 'Boot image', value: imageName ?? EMPTY },
    { label: 'Prestaged when it booted', value: session.prestaged == null ? EMPTY : session.prestaged ? 'Yes' : 'No' },
    { label: 'First seen', value: formatDateTimeSeconds(session.firstSeen) },
    { label: 'Last seen', value: formatDateTimeSeconds(session.lastSeen) },
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
          {device ? (
            "It wasn't prestaged then, and WDS answers only known clients. It's prestaged now, so WDS answers it next time."
          ) : (
            <>
              It isn't prestaged, and WDS answers only known clients. Prestage it below, or let WDS answer all clients under{' '}
              <Anchor component={Link} to="/server" inherit>
                Server settings → PXE response
              </Anchor>
              .
            </>
          )}
        </Alert>
      )}
      {device
        ? session.prestaged === false && (
            <Text size="sm">
              Prestaged since this boot, as{' '}
              <Anchor component={Link} to="/devices" inherit>
                {String(device.DeviceName)}
              </Anchor>
              .
            </Text>
          )
        : (session.deviceId || session.macAddress) && (
            <Group>
              <Button variant="light" leftSection={<IconDeviceDesktopPlus size={16} />} onClick={onPrestage}>
                Prestage this device
              </Button>
            </Group>
          )}
      <Table withRowBorders={false} verticalSpacing={4}>
        <Table.Tbody>
          {facts.map(({ label, value }) => (
            <Table.Tr key={label}>
              <Table.Td w={180}>
                <Text size="sm" c="dimmed">
                  {label}
                </Text>
              </Table.Td>
              <Table.Td>{typeof value === 'string' ? <Text size="sm">{value}</Text> : value}</Table.Td>
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
              {formatDateTimeSeconds(note.time)}
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
