import { Anchor, Badge, Card, Group, Progress, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from '@mantine/core'
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
import type { BootSession, ServerConfig, TargetInfo, WdsEvent } from '../api/types'
import { BootStatusBadge } from '../components/BootStatusBadge'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { StatCard } from '../components/StatCard'
import { baseName } from '../lib/boot'
import { isProblem, levelColor } from '../lib/events'
import { EMPTY, formatAgo, formatBytes, formatDateTime, plural } from '../lib/format'

export function DashboardPage() {
  const target = useTarget()
  const config = useServerConfig()
  const bootImages = useBootImages()
  const installImages = useInstallImages()
  const devices = useDevices()
  const activity = useActivity(72)
  const events = useEvents(24)

  const service = target.data?.wdsService
  const pending = devices.data?.autoAdd.filter((d) => d.Status === 'Pending').length
  const problems = events.data?.events.filter(isProblem) ?? []

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
          to="/devices"
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
                <RecentBoots sessions={data.sessions.slice(0, 6)} />
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
          <Anchor component={Link} to="/events" size="sm">
            All events
          </Anchor>
        </Group>
        <QueryState query={events}>
          {() =>
            problems.length === 0 ? (
              <Text c="dimmed" size="sm">
                No errors or warnings.
              </Text>
            ) : (
              <ProblemList events={problems.slice(0, 6)} />
            )
          }
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

function RecentBoots({ sessions }: { sessions: BootSession[] }) {
  return (
    <Stack gap="sm">
      {sessions.map((session) => (
        <Group key={`${session.clientIp}-${session.firstSeen}`} justify="space-between" wrap="nowrap" align="flex-start">
          <div style={{ minWidth: 0 }}>
            <Text size="sm" ff="monospace">
              {session.macAddress ?? session.clientIp}
            </Text>
            <Text size="xs" c="dimmed">
              {formatAgo(session.lastSeen)} · {session.clientIp}
              {session.bootImage ? ` · ${baseName(session.bootImage)}` : ''}
            </Text>
          </div>
          <BootStatusBadge status={session.status} />
        </Group>
      ))}
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

function ProblemList({ events }: { events: WdsEvent[] }) {
  return (
    <Stack gap="sm">
      {events.map((event) => (
        <Group key={`${event.log}-${event.recordId}`} wrap="nowrap" align="flex-start" gap="sm">
          <ThemeIcon size="sm" variant="light" color={levelColor(event.level)}>
            <IconAlertTriangle size={14} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text size="sm" lineClamp={2}>
              {event.message ?? `Event ${event.id}`}
            </Text>
            <Text size="xs" c="dimmed">
              {formatDateTime(event.time)} · {event.provider} · ID {event.id}
            </Text>
          </div>
        </Group>
      ))}
    </Stack>
  )
}
