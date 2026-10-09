import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  CloseButton,
  Drawer,
  Group,
  Menu,
  Modal,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconChevronDown, IconDots, IconPencil, IconPlus, IconSearch, IconTrash, IconUpload } from '@tabler/icons-react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  useAddBootImageDrivers,
  useBootImages,
  useChangeDriverPackage,
  useDriverPackageBatch,
  useDrivers,
  useRemoveDriverGroup,
} from '../api/queries'
import type { DriverCatalog, DriverGroup, DriverPackage, DriverPackageAction } from '../api/types'
import { AddDriversDialog } from '../components/AddDriversDialog'
import { DriverGroupEditor } from '../components/DriverGroupEditor'
import { ImportJobs } from '../components/ImportJobs'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { describeFilter } from '../lib/drivers'
import { EMPTY, formatDate, formatDateTime } from '../lib/format'

const PAGE_SIZE = 50
const ALL = '\u0000all'
const UNGROUPED = '\u0000none'

const failed = (title: string, error: unknown) =>
  notifications.show({ color: 'red', title, message: error instanceof Error ? error.message : String(error) })

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

export function DriversPage() {
  const query = useDrivers()
  const [adding, setAdding] = useState(false)
  // undefined: closed; null: creating a group; a group: changing it.
  const [editing, setEditing] = useState<DriverGroup | null | undefined>(undefined)
  const [group, setGroup] = useState<string>(ALL)
  const groups = query.data?.groups ?? []

  return (
    <>
      <PageHeader
        title="Drivers"
        description="The WDS driver store: packages WDS can add to installs, organised in driver groups that decide which clients get them."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        actions={
          <Group gap="xs">
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setEditing(null)}>
              New group
            </Button>
            <Button leftSection={<IconUpload size={16} />} onClick={() => setAdding(true)}>
              Add drivers
            </Button>
          </Group>
        }
      />
      <ImportJobs kind={['drivers', 'boot-drivers']} />
      <QueryState query={query}>
        {(catalog) => <DriverStore catalog={catalog} group={group} onGroup={setGroup} onEditGroup={setEditing} />}
      </QueryState>
      <AddDriversDialog
        opened={adding}
        onClose={() => setAdding(false)}
        groups={groups.map((g) => g.name)}
        initialGroup={group === ALL || group === UNGROUPED ? null : group}
      />
      <DriverGroupEditor opened={editing !== undefined} group={editing ?? null} names={groups.map((g) => g.name)} onClose={() => setEditing(undefined)} />
    </>
  )
}

interface DriverStoreProps {
  catalog: DriverCatalog
  /** The group being looked at: a name, or ALL or UNGROUPED. */
  group: string
  onGroup: (group: string) => void
  onEditGroup: (group: DriverGroup) => void
}

function DriverStore({ catalog, group, onGroup, onEditGroup }: DriverStoreProps) {
  const batch = useDriverPackageBatch()
  const [driverClass, setDriverClass] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [removing, setRemoving] = useState<DriverPackage[] | null>(null)
  const [toBootImage, setToBootImage] = useState<DriverPackage[] | null>(null)
  const [deletingGroup, setDeletingGroup] = useState<DriverGroup | null>(null)

  const ungrouped = catalog.packages.filter((p) => p.groups.length === 0).length
  const classes = useMemo(() => countBy(catalog.packages.map((p) => p.className ?? 'Unknown')), [catalog])
  const currentGroup = catalog.groups.find((g) => g.name === group) ?? null

  const needle = search.trim().toLowerCase()
  const matching = catalog.packages.filter(
    (p) =>
      (group === ALL || (group === UNGROUPED ? p.groups.length === 0 : p.groups.includes(group))) &&
      (!driverClass || (p.className ?? 'Unknown') === driverClass) &&
      (!needle || [p.name, p.provider, p.version, p.infPath, p.className].some((v) => v?.toLowerCase().includes(needle))),
  )
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE))
  const shown = matching.slice((Math.min(page, pages) - 1) * PAGE_SIZE, Math.min(page, pages) * PAGE_SIZE)
  // Packages chosen that still exist; a refresh may have removed some.
  const selection = catalog.packages.filter((p) => chosen.has(p.id))
  const open = catalog.packages.find((p) => p.id === openId) ?? null

  const filterChanged = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setPage(1)
  }
  const toggle = (ids: string[], on: boolean) =>
    setChosen((previous) => {
      const next = new Set(previous)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  const allShown = shown.length > 0 && shown.every((p) => chosen.has(p.id))
  const someShown = shown.some((p) => chosen.has(p.id))

  /** Runs one action on packages, saying what came of it. */
  const act = async (packages: DriverPackage[], action: DriverPackageAction, target?: string) => {
    try {
      await batch.mutateAsync({ ids: packages.map((p) => p.id), action, group: target })
      const what = packages.length === 1 ? packages[0].name : plural(packages.length, 'package')
      const done: Record<DriverPackageAction, string> = {
        enable: `Enabled ${what}`,
        disable: `Disabled ${what}`,
        remove: `Removed ${what} from WDS`,
        addToGroup: `Added ${what} to ${target}`,
        removeFromGroup: `Took ${what} out of ${target}`,
      }
      notifications.show({ color: 'green', message: done[action] })
      return true
    } catch (error) {
      failed('The driver store didn’t change as asked', error)
      return false
    }
  }

  const groupMenu = (g: DriverGroup) => (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Actions for ${g.name}`} onClick={(event) => event.stopPropagation()}>
          <IconDots size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
        <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEditGroup(g)}>
          Change…
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => setDeletingGroup(g)}>
          Delete…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: catalog.groups.length + 2 > 6 ? 6 : catalog.groups.length + 2 }}>
        <GroupCard label="All packages" count={catalog.packages.length} active={group === ALL} onClick={() => filterChanged(onGroup)(ALL)} />
        {catalog.groups.map((g) => (
          <GroupCard
            key={g.name}
            label={g.name}
            count={g.packageCount}
            detail={g.enabled ? `${g.applicability ?? 'Matched'}${g.filters.length > 0 ? ` · ${plural(g.filters.length, 'filter')}` : ''}` : 'Disabled'}
            active={group === g.name}
            onClick={() => filterChanged(onGroup)(g.name)}
            menu={groupMenu(g)}
          />
        ))}
        <GroupCard label="In no group" count={ungrouped} active={group === UNGROUPED} onClick={() => filterChanged(onGroup)(UNGROUPED)} />
      </SimpleGrid>

      {currentGroup && <GroupSummary group={currentGroup} onEdit={() => onEditGroup(currentGroup)} />}

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

      {selection.length > 0 && (
        <Card withBorder padding="xs">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Group gap="xs">
              <Text size="sm" fw={500}>
                {plural(selection.length, 'package')} chosen
              </Text>
              {selection.length < matching.length && (
                <Button variant="subtle" size="compact-xs" onClick={() => toggle(matching.map((p) => p.id), true)}>
                  Choose all {matching.length}
                </Button>
              )}
            </Group>
            <Group gap="xs">
              <Button size="xs" variant="default" loading={batch.isPending} onClick={() => void act(selection, 'enable')}>
                Enable
              </Button>
              <Button size="xs" variant="default" loading={batch.isPending} onClick={() => void act(selection, 'disable')}>
                Disable
              </Button>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <Button size="xs" variant="default" rightSection={<IconChevronDown size={14} />} disabled={catalog.groups.length === 0 || batch.isPending}>
                    Add to group
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {catalog.groups.map((g) => (
                    <Menu.Item key={g.name} onClick={() => void act(selection, 'addToGroup', g.name)}>
                      {g.name}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
              {currentGroup && (
                <Button size="xs" variant="default" loading={batch.isPending} onClick={() => void act(selection, 'removeFromGroup', currentGroup.name)}>
                  Take out of {currentGroup.name}
                </Button>
              )}
              <Button size="xs" variant="default" onClick={() => setToBootImage(selection)}>
                Add to boot image…
              </Button>
              <Button size="xs" variant="light" color="red" onClick={() => setRemoving(selection)}>
                Remove from WDS…
              </Button>
              <CloseButton size="sm" onClick={() => setChosen(new Set())} aria-label="Clear the choice" />
            </Group>
          </Group>
        </Card>
      )}

      <Card withBorder p={0}>
        {shown.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            {catalog.packages.length === 0 ? 'The driver store is empty. Add drivers to start it.' : 'No driver packages match.'}
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={960}>
            <Table striped highlightOnHover verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>
                    <Checkbox
                      checked={allShown}
                      indeterminate={someShown && !allShown}
                      onChange={() => toggle(shown.map((p) => p.id), !allShown)}
                      aria-label="Choose the packages on this page"
                    />
                  </Table.Th>
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
                    onClick={() => setOpenId(p.id)}
                    onKeyDown={(event) => event.key === 'Enter' && setOpenId(p.id)}
                  >
                    <Table.Td onClick={(event) => event.stopPropagation()}>
                      <Checkbox checked={chosen.has(p.id)} onChange={(event) => toggle([p.id], event.currentTarget.checked)} aria-label={`Choose ${p.name}`} />
                    </Table.Td>
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
            ? plural(catalog.packages.length, 'package')
            : `${matching.length} of ${plural(catalog.packages.length, 'package')}`}
        </Text>
        {pages > 1 && <Pagination total={pages} value={Math.min(page, pages)} onChange={setPage} size="sm" />}
      </Group>

      <Drawer opened={open !== null} onClose={() => setOpenId(null)} position="right" size="lg" title={open?.name}>
        {open && (
          <DriverDetail
            key={open.id}
            driver={open}
            groups={catalog.groups}
            busy={batch.isPending}
            onAction={(action, target) => void act([open], action, target)}
            onRemove={() => setRemoving([open])}
            onBootImage={() => setToBootImage([open])}
          />
        )}
      </Drawer>

      <RemovePackagesDialog
        packages={removing}
        busy={batch.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing && (await act(removing, 'remove'))) {
            toggle(removing.map((p) => p.id), false)
            if (removing.some((p) => p.id === openId)) setOpenId(null)
            setRemoving(null)
          }
        }}
      />
      <AddToBootImageDialog key={toBootImage?.map((p) => p.id).join()} packages={toBootImage} onClose={() => setToBootImage(null)} />
      <DeleteGroupDialog
        key={deletingGroup?.name}
        group={deletingGroup}
        catalog={catalog}
        onClose={(deleted) => {
          if (deleted && deletingGroup?.name === group) onGroup(ALL)
          setDeletingGroup(null)
        }}
      />
    </Stack>
  )
}

function GroupCard({
  label,
  count,
  detail,
  active,
  onClick,
  menu,
}: {
  label: string
  count: number
  detail?: string
  active: boolean
  onClick: () => void
  menu?: ReactNode
}) {
  return (
    <Card
      withBorder
      padding="sm"
      onClick={onClick}
      style={{ cursor: 'pointer', borderColor: active ? 'var(--mantine-primary-color-filled)' : undefined }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && event.target === event.currentTarget && onClick()}
    >
      <Group justify="space-between" wrap="nowrap" gap={4} align="flex-start">
        <Text size="xs" c="dimmed" fw={600} lineClamp={1}>
          {label}
        </Text>
        {menu}
      </Group>
      <Text fz={22} fw={700}>
        {count}
      </Text>
      {detail && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {detail}
        </Text>
      )}
    </Card>
  )
}

/** "A", "A and B", "A, B and C". */
const listOf = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : (items[0] ?? ''))

/** Who gets the group's drivers, in words. */
function GroupSummary({ group, onEdit }: { group: DriverGroup; onEdit: () => void }) {
  const what = group.applicability === 'All' ? 'all its packages' : 'the packages that match their hardware'
  const who = group.filters.length === 0 ? 'every client' : `clients where ${listOf(group.filters.map(describeFilter))}`
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text size="sm">
          <b>{group.name}</b> {group.enabled ? `gives ${what} to ${who}.` : 'is disabled, so no client gets its drivers.'}
        </Text>
        <Button variant="subtle" size="compact-sm" leftSection={<IconPencil size={14} />} onClick={onEdit} style={{ flexShrink: 0 }}>
          Change
        </Button>
      </Group>
    </Card>
  )
}

interface DriverDetailProps {
  driver: DriverPackage
  groups: DriverGroup[]
  busy: boolean
  onAction: (action: DriverPackageAction, group?: string) => void
  onRemove: () => void
  onBootImage: () => void
}

function DriverDetail({ driver, groups, busy, onAction, onRemove, onBootImage }: DriverDetailProps) {
  const rename = useChangeDriverPackage()
  const [name, setName] = useState(driver.name)
  const others = groups.filter((g) => !driver.groups.includes(g.name))

  const saveName = async () => {
    try {
      await rename.mutateAsync({ id: driver.id, changes: { name: name.trim() } })
      notifications.show({ color: 'green', message: `Renamed it ${name.trim()}` })
    } catch (error) {
      failed('Couldn’t rename the package', error)
    }
  }

  const facts: [string, string][] = [
    ['Provider', driver.provider ?? EMPTY],
    ['Class', driver.className ? `${driver.className} ${driver.classGuid ?? ''}` : EMPTY],
    ['Architecture', driver.architecture ?? EMPTY],
    ['Version', driver.version ?? EMPTY],
    ['Driver date', formatDate(driver.date)],
    ['Added to WDS', formatDateTime(driver.dateAdded)],
    ['Signature', driver.signed ? 'Valid' : 'Not signed'],
    ['Locale', driver.locale ?? EMPTY],
    ['INF file', driver.infPath ?? EMPTY],
    ['Package ID', driver.id],
  ]

  return (
    <Stack>
      <Switch
        label="Enabled"
        description="WDS gives clients only enabled packages."
        checked={driver.enabled}
        disabled={busy}
        onChange={(event) => onAction(event.currentTarget.checked ? 'enable' : 'disable')}
      />
      <Group align="flex-end" gap="xs">
        <TextInput label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} style={{ flex: 1 }} />
        <Button variant="default" onClick={saveName} loading={rename.isPending} disabled={!name.trim() || name.trim() === driver.name}>
          Rename
        </Button>
      </Group>
      <div>
        <Text size="sm" fw={500} mb={6}>
          Driver groups
        </Text>
        <Group gap={6}>
          {driver.groups.length === 0 && (
            <Text size="sm" c="dimmed">
              None, so no install gets this package.
            </Text>
          )}
          {driver.groups.map((g) => (
            <Badge
              key={g}
              variant="light"
              tt="none"
              rightSection={
                <Tooltip label={`Take it out of ${g}`}>
                  <CloseButton size="xs" disabled={busy} onClick={() => onAction('removeFromGroup', g)} aria-label={`Take it out of ${g}`} />
                </Tooltip>
              }
            >
              {g}
            </Badge>
          ))}
        </Group>
        {others.length > 0 && (
          <Select
            mt="xs"
            placeholder="Add it to a group"
            data={others.map((g) => g.name)}
            value={null}
            onChange={(value) => value && onAction('addToGroup', value)}
            disabled={busy}
            comboboxProps={{ withinPortal: true }}
          />
        )}
      </div>
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
      <Group>
        <Button variant="default" onClick={onBootImage}>
          Add to a boot image…
        </Button>
        <Button color="red" variant="light" leftSection={<IconTrash size={16} />} onClick={onRemove}>
          Remove from WDS…
        </Button>
      </Group>
    </Stack>
  )
}

function RemovePackagesDialog({
  packages,
  busy,
  onCancel,
  onConfirm,
}: {
  packages: DriverPackage[] | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const one = packages?.length === 1
  return (
    <Modal opened={packages !== null} onClose={onCancel} title={one ? `Remove ${packages![0].name}?` : `Remove ${plural(packages?.length ?? 0, 'package')}?`} centered>
      <Text size="sm">
        {one ? 'The package is' : 'The packages are'} deleted from the WDS driver store and taken out of every group. Installs already done keep
        their drivers.
      </Text>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button color="red" loading={busy} onClick={onConfirm}>
          Remove
        </Button>
      </Group>
    </Modal>
  )
}

/**
 * Writes driver packages into a boot image, such as network or storage drivers WinPE lacks. WDS saves the
 * image after each package and can't take one out again, so it says so first.
 */
function AddToBootImageDialog({ packages, onClose }: { packages: DriverPackage[] | null; onClose: () => void }) {
  const bootImages = useBootImages()
  const add = useAddBootImageDrivers()
  const architectures = [...new Set((packages ?? []).map((p) => (p.architecture ?? '').toLowerCase()))]
  const images = (bootImages.data ?? []).filter((image) => architectures.includes(String(image.Architecture ?? '').toLowerCase()))
  const [chosen, setChosen] = useState<string | null>(null)
  const image = images.find((i) => `${String(i.Architecture)}|${String(i.FileName)}` === chosen) ?? null

  const start = async () => {
    if (!packages || !image) return
    try {
      await add.mutateAsync({
        imageName: String(image.Name),
        architecture: String(image.Architecture),
        fileName: String(image.FileName),
        packageIds: packages.map((p) => p.id),
      })
      notifications.show({ title: 'Adding drivers to the boot image', message: `Writing them into ${String(image.Name)}. The progress shows on this page.` })
      onClose()
    } catch {
      // Shown from add.error.
    }
  }

  return (
    <Modal opened={packages !== null} onClose={onClose} title={`Add ${plural(packages?.length ?? 0, 'package')} to a boot image`} centered size="lg">
      <Stack>
        <Text size="sm">
          For drivers WinPE needs before Windows is installed, such as network and storage drivers. WDS writes each package into the
          boot image file, which takes a minute or two each.
        </Text>
        <Alert color="orange" icon={<IconAlertTriangle />}>
          WDS can’t take drivers out of a boot image again. To undo this, import the boot image again.
        </Alert>
        {architectures.length > 1 ? (
          <Alert color="red" icon={<IconAlertTriangle />}>
            These packages are for different architectures ({architectures.join(', ')}). Choose packages for one architecture.
          </Alert>
        ) : (
          <Select
            label="Boot image"
            placeholder={bootImages.isPending ? 'Loading boot images…' : images.length === 0 ? `No ${architectures[0]} boot images` : 'Choose a boot image'}
            data={images.map((i) => ({
              value: `${String(i.Architecture)}|${String(i.FileName)}`,
              label: `${String(i.Name)} (${String(i.FileName)}${i.Enabled === false ? ', disabled' : ''})`,
            }))}
            value={chosen}
            onChange={setChosen}
            comboboxProps={{ withinPortal: true }}
          />
        )}
        {add.error && (
          <Alert color="red" icon={<IconAlertTriangle />}>
            {add.error.message}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={start} loading={add.isPending} disabled={!image || architectures.length > 1}>
            Add to boot image
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Deletes a driver group, and if asked, the packages that were in it and no other group. */
function DeleteGroupDialog({ group, catalog, onClose }: { group: DriverGroup | null; catalog: DriverCatalog; onClose: (deleted: boolean) => void }) {
  const remove = useRemoveDriverGroup()
  const batch = useDriverPackageBatch()
  const [alsoPackages, setAlsoPackages] = useState(false)
  const onlyHere = group ? catalog.packages.filter((p) => p.groups.length === 1 && p.groups[0] === group.name) : []

  const confirm = async () => {
    if (!group) return
    try {
      await remove.mutateAsync(group.name)
      if (alsoPackages && onlyHere.length > 0) await batch.mutateAsync({ ids: onlyHere.map((p) => p.id), action: 'remove' })
      notifications.show({
        color: 'green',
        message: `Deleted ${group.name}${alsoPackages && onlyHere.length > 0 ? ` and ${plural(onlyHere.length, 'package')}` : ''}`,
      })
      onClose(true)
    } catch (error) {
      failed(`Couldn’t delete ${group.name}`, error)
    }
  }

  return (
    <Modal opened={group !== null} onClose={() => onClose(false)} title={`Delete ${group?.name}?`} centered>
      <Text size="sm">No client gets drivers from this group any more. Its packages stay in the driver store.</Text>
      {onlyHere.length > 0 && (
        <Checkbox
          mt="md"
          label={`Also remove its ${plural(onlyHere.length, 'package')} that ${onlyHere.length === 1 ? 'isn’t' : 'aren’t'} in any other group`}
          checked={alsoPackages}
          onChange={(event) => setAlsoPackages(event.currentTarget.checked)}
        />
      )}
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={() => onClose(false)}>
          Cancel
        </Button>
        <Button color="red" loading={remove.isPending || batch.isPending} onClick={confirm}>
          Delete
        </Button>
      </Group>
    </Modal>
  )
}

function countBy(values: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}
