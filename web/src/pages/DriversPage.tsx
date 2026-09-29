import { Badge, Card, Drawer, Group, Pagination, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useDrivers } from '../api/queries'
import type { DriverCatalog, DriverPackage } from '../api/types'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { EMPTY, formatDate, formatDateTime } from '../lib/format'

const PAGE_SIZE = 50
const ALL = '\u0000all'
const UNGROUPED = '\u0000none'

export function DriversPage() {
  const query = useDrivers()

  return (
    <>
      <PageHeader
        title="Drivers"
        description="The WDS driver store: packages WDS can add to installs and inject into boot images, organised in driver groups."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />
      <QueryState query={query}>{(catalog) => <DriverStore catalog={catalog} />}</QueryState>
    </>
  )
}

function DriverStore({ catalog }: { catalog: DriverCatalog }) {
  const [group, setGroup] = useState<string>(ALL)
  const [driverClass, setDriverClass] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<DriverPackage | null>(null)

  const ungrouped = catalog.packages.filter((p) => p.groups.length === 0).length
  const classes = useMemo(() => countBy(catalog.packages.map((p) => p.className ?? 'Unknown')), [catalog])

  const needle = search.trim().toLowerCase()
  const matching = catalog.packages.filter(
    (p) =>
      (group === ALL || (group === UNGROUPED ? p.groups.length === 0 : p.groups.includes(group))) &&
      (!driverClass || (p.className ?? 'Unknown') === driverClass) &&
      (!needle || [p.name, p.provider, p.version, p.infPath, p.className].some((v) => v?.toLowerCase().includes(needle))),
  )
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const shown = matching.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE)

  const filterChanged = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setPage(1)
  }

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: catalog.groups.length + 2 > 6 ? 6 : catalog.groups.length + 2 }}>
        <GroupCard label="All packages" count={catalog.packages.length} active={group === ALL} onClick={() => filterChanged(setGroup)(ALL)} />
        {catalog.groups.map((g) => (
          <GroupCard
            key={g.name}
            label={g.name}
            count={g.packageCount}
            detail={g.enabled ? g.applicability ?? undefined : 'Disabled'}
            active={group === g.name}
            onClick={() => filterChanged(setGroup)(g.name)}
          />
        ))}
        <GroupCard label="In no group" count={ungrouped} active={group === UNGROUPED} onClick={() => filterChanged(setGroup)(UNGROUPED)} />
      </SimpleGrid>

      <Group gap="sm">
        <TextInput
          placeholder="Search names, providers, versions and INF paths"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => filterChanged(setSearch)(event.currentTarget.value)}
          style={{ flex: 1, minWidth: 240 }}
        />
        <Select
          placeholder="All classes"
          data={classes.map(([name, count]) => ({ value: name, label: `${name} (${count})` }))}
          value={driverClass}
          onChange={filterChanged(setDriverClass)}
          clearable
          w={240}
        />
      </Group>

      <Card withBorder p={0}>
        {shown.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            No driver packages match.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={900}>
            <Table striped highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Package</Table.Th>
                  <Table.Th>Class</Table.Th>
                  <Table.Th>Arch</Table.Th>
                  <Table.Th>Version</Table.Th>
                  <Table.Th>Driver date</Table.Th>
                  <Table.Th>Groups</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((p) => (
                  <Table.Tr
                    key={p.id}
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(p)}
                    onKeyDown={(event) => event.key === 'Enter' && setSelected(p)}
                  >
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {p.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {p.provider ?? EMPTY}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{p.className ?? EMPTY}</Text>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Text size="sm">{p.architecture ?? EMPTY}</Text>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Text size="sm">{p.version ?? EMPTY}</Text>
                    </Table.Td>
                    <Table.Td style={{ whiteSpace: 'nowrap' }}>
                      <Text size="sm">{formatDate(p.date)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {p.groups.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            None
                          </Text>
                        ) : (
                          p.groups.map((g) => (
                            <Badge key={g} size="sm" variant="light" tt="none">
                              {g}
                            </Badge>
                          ))
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Badge size="sm" variant="light" color={p.enabled ? 'green' : 'gray'} tt="none">
                          {p.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                        {!p.signed && (
                          <Badge size="sm" variant="light" color="red" tt="none">
                            Unsigned
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>

      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {matching.length === catalog.packages.length
            ? `${catalog.packages.length} packages`
            : `${matching.length} of ${catalog.packages.length} packages`}
        </Text>
        {pages > 1 && <Pagination total={pages} value={Math.min(page, pages)} onChange={setPage} size="sm" />}
      </Group>

      <Drawer opened={selected !== null} onClose={() => setSelected(null)} position="right" size="lg" title={selected?.name}>
        {selected && <DriverDetail driver={selected} />}
      </Drawer>
    </Stack>
  )
}

function GroupCard({ label, count, detail, active, onClick }: { label: string; count: number; detail?: string; active: boolean; onClick: () => void }) {
  return (
    <Card
      withBorder
      padding="sm"
      onClick={onClick}
      style={{ cursor: 'pointer', borderColor: active ? 'var(--mantine-primary-color-filled)' : undefined }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onClick()}
    >
      <Text size="xs" c="dimmed" fw={600} lineClamp={1}>
        {label}
      </Text>
      <Text fz={22} fw={700}>
        {count}
      </Text>
      {detail && (
        <Text size="xs" c="dimmed">
          {detail}
        </Text>
      )}
    </Card>
  )
}

function DriverDetail({ driver }: { driver: DriverPackage }) {
  const facts: [string, string][] = [
    ['Provider', driver.provider ?? EMPTY],
    ['Class', driver.className ? `${driver.className} ${driver.classGuid ?? ''}` : EMPTY],
    ['Architecture', driver.architecture ?? EMPTY],
    ['Version', driver.version ?? EMPTY],
    ['Driver date', formatDate(driver.date)],
    ['Added to WDS', formatDateTime(driver.dateAdded)],
    ['Groups', driver.groups.join(', ') || 'None'],
    ['Enabled', driver.enabled ? 'Yes' : 'No'],
    ['Signature', driver.signed ? 'Valid' : 'Not signed'],
    ['Locale', driver.locale ?? EMPTY],
    ['INF file', driver.infPath ?? EMPTY],
    ['Package ID', driver.id],
  ]
  return (
    <Table withRowBorders={false} verticalSpacing={4} layout="fixed">
      <Table.Tbody>
        {facts.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td w="32%" style={{ verticalAlign: 'top' }}>
              <Text size="sm" c="dimmed">
                {label}
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="sm" style={{ wordBreak: 'break-all' }}>
                {value}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function countBy(values: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}
