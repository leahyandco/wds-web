import { Anchor, Badge, Card, Group, NavLink, Progress, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconDevices,
  IconDisc,
  IconRocket,
  IconServer,
} from '@tabler/icons-react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useActivity, useBootImages, useDevices, useEvents, useInstallImages, useServerConfig, useTarget } from '../api/queries'
import type { BootSession, ServerConfig, TargetInfo, WdsEvent, WdsRecord } from '../api/types'
import { BootStatusBadge } from '../components/BootStatusBadge'
import { DeploymentStageBadge } from '../components/DeploymentStageBadge'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { StatCard } from '../components/StatCard'
import { clientAddress } from '../lib/boot'
import { bootImageName, prestagedDevice } from '../lib/devices'
import { eventKey, isExpectedWarning, levelColor } from '../lib/events'
import { EMPTY, formatAgo, formatBytes, formatDateTime, plural } from '../lib/format'
import { findValue, isYes } from '../lib/wdsutil'

export function DashboardPage() {
  const target = useTarget()
  const config = useServerConfig()
  const bootImages = useBootImages()
  const installImages = useInstallImages()
  const devices = useDevices()
  const activity = useActivity(72)
  const events = useEvents(24, { problemsOnly: true })

  const service = target.data?.wdsService
  const pending = devices.data?.autoAdd.filter((d) => d.Status === 'Pending').length

  // Whether WDS had a WDS client unattend file for the client whose request it refused: the server's, or its
  // device's own. The refusal is matched to its boot by time, as Boot activity records it; when that can't be
  // told, the refusal counts as a problem.
  const serverUnattend = config.data ? isYes(findValue(config.data.sections, ['WDS Client Policy', 'Unattend policy', 'Enabled'])) : null
  const unattendExpected = (event: WdsEvent) => {
    if (serverUnattend !== false) return true
    const time = new Date(event.time).getTime()
    const session = activity.data?.sessions.find((s) =>
      s.notes.some((note) => note.kind === 'unattendBlocked' && Math.abs(new Date(note.time).getTime() - time) < 1000),
    )
    if (!session) return true
    const device = prestagedDevice(devices.data?.prestaged ?? [], session.macAddress, session.deviceId)
    return String(device?.WdsClientUnattend ?? '').trim() !== ''
  }
  const problems = events.data?.events.filter((event) => !isExpectedWarning(event, unattendExpected)) ?? []
  const expected = (events.data?.events.length ?? 0) - problems.length

  return (
    <>
      <PageHeader title="Dashboard" description="The WDS server at a glance." />

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="lg">
        <StatCard
          label="WDS service"
          to="/server"
          icon={<IconServer size={22} />}
          color={service?.status === 'Running' ? 'green' : service ? 'red' : 'gray'}
          value={statValue(target, (t) => t.wdsService?.status ?? 'Not installed')}
          detail={service ? `Starts: ${service.startType}` : undefined}
        />
        <StatCard
          label="Boot images"
          to="/boot-images"
          icon={<IconRocket size={22} />}
          value={statValue(bootImages, (images) => images.length)}
          detail={bootImages.data ? `${bootImages.data.filter((i) => i.Enabled !== false).length} enabled` : undefined}
        />
        <StatCard
          label="Install images"
          to="/install-images"
          icon={<IconDisc size={22} />}
          value={statValue(installImages, (data) => data.images.length)}
          detail={installImages.data ? plural(installImages.data.groups.length, 'image group') : undefined}
        />
        <StatCard
          label="Pending devices"
          to={pending ? '/devices?tab=requests' : '/devices'}
          icon={<IconDevices size={22} />}
          color={pending ? 'yellow' : 'blue'}
          value={statValue(devices, () => pending ?? 0)}
          detail={devices.data ? plural(devices.data.prestaged.length, 'prestaged device') : undefined}
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} mb="lg">
        <Card withBorder padding="lg">
          <Group justify="space-between" mb="sm">
            <Title order={4}>Recent boots</Title>
            <Anchor component={Link} to="/activity" size="sm">
              All boot activity
            </Anchor>
          </Group>
          <QueryState query={activity}>
            {(data) =>
              data.sessions.length === 0 ? (
                <Text c="dimmed" size="sm">
                  No PXE boots in the last 3 days.
                </Text>
              ) : (
                <RecentBoots sessions={data.sessions.slice(0, 6)} devices={devices.data?.prestaged ?? []} bootImages={bootImages.data ?? []} />
              )
            }
          </QueryState>
        </Card>

        <Card withBorder padding="lg">
          <Title order={4} mb="sm">
            Server
          </Title>
          <QueryState query={target}>{(data) => <ServerFacts target={data} config={config.data} />}</QueryState>
        </Card>
      </SimpleGrid>

      <Card withBorder padding="lg">
        <Group justify="space-between" mb="sm">
          <Title order={4}>Problems in the last 24 hours</Title>
          <Anchor component={Link} to="/events?level=problems" size="sm">
            All events
          </Anchor>
        </Group>
        <QueryState query={events}>
          {() => (
            <Stack gap="xs">
              {problems.length === 0 ? (
                <Text c="dimmed" size="sm">
                  No errors or warnings.
                </Text>
              ) : (
                <ProblemList events={problems.slice(0, 6)} />
              )}
              {expected > 0 && (
                <Text size="xs" c="dimmed">
                  Not counted: {plural(expected, 'warning')} WDS logs in the normal run of things, such as for an install straight
                  from the server, which Boot activity explains.
                </Text>
              )}
            </Stack>
          )}
        </QueryState>
      </Card>
    </>
  )
}

function statValue<T>(query: UseQueryResult<T>, select: (data: T) => ReactNode): ReactNode {
  if (query.isError) return EMPTY
  if (query.isPending) return '…'
  return select(query.data)
}

/** The latest boots, each opening its details on the Boot activity page. */
function RecentBoots({ sessions, devices, bootImages }: { sessions: BootSession[]; devices: WdsRecord[]; bootImages: WdsRecord[] }) {
  return (
    <Stack gap={2}>
      {sessions.map((session) => {
        const device = prestagedDevice(devices, session.macAddress, session.deviceId)
        const what = session.deployment?.imageName ?? (session.bootImage ? bootImageName(bootImages, session.bootImage) : null)
        return (
          <NavLink
            key={session.id}
            component={Link}
            to={`/activity?boot=${encodeURIComponent(session.id)}`}
            px={6}
            label={
              device ? (
                String(device.DeviceName)
              ) : (
                <Text size="sm" ff="monospace" span>
                  {session.macAddress ?? session.clientIp}
                </Text>
              )
            }
            description={[formatAgo(session.lastSeen), clientAddress(session), what].filter(Boolean).join(' · ')}
            // Once the WDS client reports an install, its stage says more than the boot's.
            rightSection={session.deployment ? <DeploymentStageBadge stage={session.deployment.stage} /> : <BootStatusBadge status={session.status} />}
          />
        )
      })}
    </Stack>
  )
}

function ServerFacts({ target, config }: { target: TargetInfo; config: ServerConfig | undefined }) {
  const facts: [string, string][] = [
    ['Name', target.computerName],
    ['Operating system', `${target.osCaption}, build ${target.osBuild}`],
    [target.partOfDomain ? 'Domain' : 'Workgroup', target.domain],
    ['Last boot', formatDateTime(target.lastBootTime)],
  ]
  const volume = config?.remoteInstall
  const usedPercent = volume ? 100 - (volume.freeBytes / volume.totalBytes) * 100 : null

  return (
    <Stack gap="md">
      <Table withRowBorders={false} verticalSpacing={4}>
        <Table.Tbody>
          {facts.map(([label, value]) => (
            <Table.Tr key={label}>
              <Table.Td w={170}>
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

      {volume && usedPercent != null && (
        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm">RemoteInstall ({volume.path})</Text>
            <Text size="sm" c={usedPercent > 90 ? 'red' : 'dimmed'}>
              {formatBytes(volume.freeBytes)} free of {formatBytes(volume.totalBytes)}
            </Text>
          </Group>
          <Progress value={usedPercent} color={usedPercent > 90 ? 'red' : usedPercent > 75 ? 'yellow' : 'blue'} aria-label="RemoteInstall volume used" />
        </div>
      )}

      <Group gap="xs">
        {target.features.map((feature) => (
          <Badge
            key={feature.name}
            variant="light"
            color={feature.installed ? 'green' : 'gray'}
            leftSection={feature.installed ? <IconCircleCheck size={14} /> : <IconCircleX size={14} />}
            tt="none"
          >
            {feature.displayName}
          </Badge>
        ))}
      </Group>
    </Stack>
  )
}


/** Errors and warnings, each opening on the Events page. */
function ProblemList({ events }: { events: WdsEvent[] }) {
  return (
    <Stack gap={2}>
      {events.map((event) => (
        <NavLink
          key={eventKey(event)}
          component={Link}
          to={`/events?${new URLSearchParams({ level: 'problems', event: eventKey(event) })}`}
          px={6}
          leftSection={
            <ThemeIcon size="sm" variant="light" color={levelColor(event.level)}>
              <IconAlertTriangle size={14} />
            </ThemeIcon>
          }
          label={
            <Text size="sm" lineClamp={2}>
              {event.message ?? `Event ${event.id}`}
            </Text>
          }
          description={`${formatDateTime(event.time)} · ${event.provider} · ID ${event.id}`}
        />
      ))}
    </Stack>
  )
}
