import { Alert, Badge, Button, Card, Drawer, Group, SegmentedControl, Stack, Switch, Table, Text, TextInput } from '@mantine/core'
import { IconAlertTriangle, IconDownload, IconInfoCircle, IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { useEvents } from '../api/queries'
import type { WdsEvent } from '../api/types'
import { CopyCode } from '../components/Copy'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { eventKey, isProblem, levelColor, levelLabel, sourceLabel } from '../lib/events'
import { csvTime, datedName, downloadCsv } from '../lib/csv'
import { formatDateTimeSeconds, plural } from '../lib/format'
import { useUrlParams } from '../lib/urlState'
import { openOnKey } from '../lib/keys'

const ranges = [
  { label: '24 hours', value: '24' },
  { label: '3 days', value: '72' },
  { label: '7 days', value: '168' },
  { label: '30 days', value: '720' },
]
const DEFAULT_RANGE = '72'

/** How many events to fetch, newest first: a page's worth, then more on asking, up to what the server allows. */
const limits = [300, 1000, 5000]

export function EventsPage() {
  // The filters and the open event are in the address, so they survive a reload and the dashboard can link to a
  // problem. The search box keeps its own text, as the address updates a moment later.
  const [params, update] = useUrlParams()
  const hours = params.get('range') ?? DEFAULT_RANGE
  const problemsOnly = params.get('level') === 'problems'
  const includeRoutine = params.get('routine') === '1'
  const openKey = params.get('event')
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  const [max, setMax] = useState(limits[0])
  const query = useEvents(Number(hours), { includeRoutine, problemsOnly, max })


  // The open event as last loaded; it stays open if a refresh or another filter no longer lists it.
  const found = openKey ? query.data?.events.find((event) => eventKey(event) === openKey) : undefined
  const [kept, setKept] = useState<WdsEvent | null>(null)
  if (found && found !== kept) setKept(found)
  const selected = found ?? (kept && eventKey(kept) === openKey ? kept : null)

  const needle = search.trim().toLowerCase()
  // The server filters problems too; this also covers the old list shown while a new one loads.
  const visible = (query.data?.events ?? []).filter(
    (event) =>
      (!problemsOnly || isProblem(event)) &&
      (!needle || `${event.message ?? ''} ${event.id} ${event.provider} ${event.log}`.toLowerCase().includes(needle)),
  )

  /** The events shown, as filtered, as a CSV file. */
  const exportCsv = () =>
    downloadCsv(datedName('wds-events'), [
      ['Time', 'Level', 'ID', 'Source', 'Log', 'Message'],
      ...visible.map((event) => [csvTime(event.time), levelLabel(event), event.id, event.provider, event.log, event.message]),
    ])

  return (
    <>
      <PageHeader
        title="Events"
        description="WDS diagnostics and service events. Refreshes every 30 seconds."
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
        <SegmentedControl
          data={[
            { label: 'All levels', value: 'all' },
            { label: 'Errors and warnings', value: 'problems' },
          ]}
          value={problemsOnly ? 'problems' : 'all'}
          onChange={(value) => update({ level: value === 'problems' ? 'problems' : null })}
        />
        <TextInput
          placeholder="Search messages, IDs and sources"
          aria-label="Search events"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value)
            update({ q: event.currentTarget.value })
          }}
          style={{ flex: 1, minWidth: 220 }}
        />
        <Switch
          label="Routine events"
          checked={includeRoutine}
          onChange={(event) => update({ routine: event.currentTarget.checked ? '1' : null })}
        />
      </Group>

      <QueryState query={query}>
        {({ events, total, routineHidden, warnings }) => {
          const more = limits.find((limit) => limit > max)
          return (
            <Stack>
              {warnings.map((warning) => (
                <Alert key={warning} color="yellow" icon={<IconAlertTriangle />}>
                  {warning}
                </Alert>
              ))}
              {total > events.length && (
                <Alert color="blue" icon={<IconInfoCircle />} p="xs">
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Text size="sm">
                      Showing the newest {events.length.toLocaleString()} of {plural(total, 'event')} in this period
                      {needle ? '; the search looks only at those' : ''}.
                    </Text>
                    {more && (
                      <Button size="compact-sm" variant="light" onClick={() => setMax(more)} loading={query.isFetching}>
                        Show up to {more.toLocaleString()}
                      </Button>
                    )}
                  </Group>
                </Alert>
              )}
              <Card withBorder p={0}>
                {visible.length === 0 ? (
                  <Text c="dimmed" ta="center" py="xl">
                    No events match.
                  </Text>
                ) : (
                  <EventTable events={visible} onSelect={(event) => update({ event: eventKey(event) })} />
                )}
              </Card>
              {routineHidden > 0 && !problemsOnly && (
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
        onClose={() => update({ event: null })}
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
              key={eventKey(event)}
              tabIndex={0}
              style={{ cursor: 'pointer' }}
              onClick={() => onSelect(event)}
              onKeyDown={openOnKey(() => onSelect(event))}
            >
              <Table.Td style={{ whiteSpace: 'nowrap' }}>
                <Text size="sm">{formatDateTimeSeconds(event.time)}</Text>
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
          {formatDateTimeSeconds(event.time)}
        </Text>
      </Group>
      <Text size="sm">
        <b>Source:</b> {event.provider}
      </Text>
      <Text size="sm">
        <b>Log:</b> {event.log}
      </Text>
      <CopyCode value={event.message ?? 'This event has no message text.'} label="Copy the message" />
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
