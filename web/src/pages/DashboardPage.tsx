import { Anchor, Badge, Card, Group, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from '@mantine/core'
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
import { useBootImages, useDevices, useEvents, useInstallImages, useTarget } from '../api/queries'
import type { TargetInfo, WdsEvent } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { StatCard } from '../components/StatCard'
import { isProblem, levelColor } from '../lib/events'
import { EMPTY, formatDateTime, plural } from '../lib/format'

export function DashboardPage() {
  const target = useTarget()
  const bootImages = useBootImages()
  const installImages = useInstallImages()
  const devices = useDevices()
  const events = useEvents(24)

  const service = target.data?.wdsService
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
        />
        <StatCard
          label="Install images"
          to="/install-images"
          icon={<IconDisc size={22} />}
          value={statValue(installImages, (data) => data.images.length)}
          detail={installImages.data ? plural(installImages.data.groups.length, 'image group') : undefined}
        />
        <StatCard
          label="Auto-add requests"
          to="/devices"
          icon={<IconDevices size={22} />}
          value={statValue(devices, (data) => data.autoAdd.length)}
          detail={devices.data ? plural(devices.data.prestaged.length, 'prestaged device') : undefined}
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Card withBorder padding="lg">
          <Title order={4} mb="sm">
            Server
          </Title>
          <QueryState query={target}>{(data) => <ServerFacts target={data} />}</QueryState>
        </Card>

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
      </SimpleGrid>
    </>
  )
}

function statValue<T>(query: UseQueryResult<T>, select: (data: T) => ReactNode): ReactNode {
  if (query.isError) return EMPTY
  if (query.isPending) return '…'
  return select(query.data)
}

function ServerFacts({ target }: { target: TargetInfo }) {
  const facts: [string, string][] = [
    ['Name', target.computerName],
    ['Operating system', `${target.osCaption}, build ${target.osBuild}`],
    [target.partOfDomain ? 'Domain' : 'Workgroup', target.domain],
    ['Last boot', formatDateTime(target.lastBootTime)],
    ['WDS PowerShell module', target.wdsModule ?? 'Not installed'],
  ]

  return (
    <Stack gap="md">
      <Table withRowBorders={false} verticalSpacing={4}>
        <Table.Tbody>
          {facts.map(([label, value]) => (
            <Table.Tr key={label}>
              <Table.Td w={200}>
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
