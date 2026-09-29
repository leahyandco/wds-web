import { Alert, Badge, Card, Code, Drawer, Group, SegmentedControl, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import { IconAlertTriangle, IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { useEvents } from '../api/queries'
import type { WdsEvent } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { isProblem, levelColor, levelLabel, sourceLabel } from '../lib/events'
import { formatDateTime, plural } from '../lib/format'

const ranges = [
  { label: '24 hours', value: '24' },
  { label: '3 days', value: '72' },
  { label: '7 days', value: '168' },
  { label: '30 days', value: '720' },
]

export function EventsPage() {
  const [hours, setHours] = useState('72')
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [includeRoutine, setIncludeRoutine] = useState(false)
  const [selected, setSelected] = useState<WdsEvent | null>(null)
  const query = useEvents(Number(hours), includeRoutine)

  return (
    <>
      <PageHeader
        title="Events"
        description="WDS diagnostics and service events. Refreshes every 30 seconds."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />

      <Group mb="md" gap="sm">
        <SegmentedControl data={ranges} value={hours} onChange={setHours} />
        <SegmentedControl
          data={[
            { label: 'All levels', value: 'all' },
            { label: 'Errors and warnings', value: 'problems' },
          ]}
          value={problemsOnly ? 'problems' : 'all'}
          onChange={(value) => setProblemsOnly(value === 'problems')}
        />
        <TextInput
          placeholder="Search messages, IDs and sources"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <Switch
          label="Routine events"
          checked={includeRoutine}
          onChange={(event) => setIncludeRoutine(event.currentTarget.checked)}
        />
      </Group>

      <QueryState query={query}>
        {({ events, routineHidden, warnings }) => {
          const needle = search.trim().toLowerCase()
          const visible = events.filter(
            (event) =>
              (!problemsOnly || isProblem(event)) &&
              (!needle || `${event.message ?? ''} ${event.id} ${event.provider} ${event.log}`.toLowerCase().includes(needle)),
          )
          return (
            <Stack>
              {warnings.map((warning) => (
                <Alert key={warning} color="yellow" icon={<IconAlertTriangle />}>
                  {warning}
                </Alert>
              ))}
              <Card withBorder p={0}>
                {visible.length === 0 ? (
                  <Text c="dimmed" ta="center" py="xl">
                    No events match.
                  </Text>
                ) : (
                  <EventTable events={visible} onSelect={setSelected} />
                )}
              </Card>
              {routineHidden > 0 && (
                <Text size="sm" c="dimmed">
                  {plural(routineHidden, 'routine event')} hidden: TFTP housekeeping and management calls, including this
                  console's own. Turn on "Routine events" to see them.
                </Text>
              )}
            </Stack>
          )
        }}
      </QueryState>

      <Drawer
        opened={selected !== null}
        onClose={() => setSelected(null)}
        position="right"
        size="lg"
        title={selected ? `Event ${selected.id}` : undefined}
      >
        {selected && <EventDetail event={selected} />}
      </Drawer>
    </>
  )
}

function EventTable({ events, onSelect }: { events: WdsEvent[]; onSelect: (event: WdsEvent) => void }) {
  return (
    <Table.ScrollContainer minWidth={760}>
      <Table striped highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Time</Table.Th>
            <Table.Th>Level</Table.Th>
            <Table.Th>ID</Table.Th>
            <Table.Th>Source</Table.Th>
            <Table.Th>Message</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {events.map((event) => (
            <Table.Tr
              key={`${event.log}-${event.recordId}`}
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(event)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(event)}
            >
              <Table.Td style={{ whiteSpace: 'nowrap' }}>
                <Text size="sm">{formatDateTime(event.time)}</Text>
              </Table.Td>
              <Table.Td>
                <Badge variant="light" color={levelColor(event.level)} tt="none">
                  {levelLabel(event)}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{event.id}</Text>
              </Table.Td>
              <Table.Td style={{ whiteSpace: 'nowrap' }}>
                <Text size="sm">{sourceLabel(event)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" lineClamp={1}>
                  {event.message ?? ''}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

function EventDetail({ event }: { event: WdsEvent }) {
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge variant="light" color={levelColor(event.level)} tt="none">
          {levelLabel(event)}
        </Badge>
        <Text size="sm" c="dimmed">
          {formatDateTime(event.time)}
        </Text>
      </Group>
      <Text size="sm">
        <b>Source:</b> {event.provider}
      </Text>
      <Text size="sm">
        <b>Log:</b> {event.log}
      </Text>
      <Code block>{event.message ?? 'This event has no message text.'}</Code>
      {Object.keys(event.data).length > 0 && (
        <Table withRowBorders={false} verticalSpacing={2}>
          <Table.Tbody>
            {Object.entries(event.data).map(([name, value]) => (
              <Table.Tr key={name}>
                <Table.Td w="40%">
                  <Text size="sm" c="dimmed">
                    {name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" style={{ wordBreak: 'break-word' }}>
                    {value}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  )
}
