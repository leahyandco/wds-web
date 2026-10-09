import { Alert, Anchor, Badge, Button, Card, CloseButton, Group, Stack, Tabs, Text, TextInput } from '@mantine/core'
import { IconAlertTriangle, IconDownload, IconInfoCircle, IconListDetails, IconPlus, IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useBootImages, useDevices } from '../api/queries'
import type { WdsRecord } from '../api/types'
import { CopyValue } from '../components/Copy'
import { DeviceEditor } from '../components/DeviceEditor'
import { ClearRequestsButton, DeviceActionsMenu, RequestActionsMenu, RequestBulkActions } from '../components/DeviceMenus'
import { ImportDevicesDialog } from '../components/ImportDevicesDialog'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable, type RecordColumn } from '../components/RecordTable'
import { approvedRequestFor, bootImageName, devicePrompt } from '../lib/devices'
import { datedName, downloadCsv } from '../lib/csv'
import { formatValue } from '../lib/format'
import { asString, pick } from '../lib/records'
import { useUrlParams } from '../lib/urlState'

const statusColors: Record<string, string> = { Pending: 'yellow', Approved: 'green', Denied: 'red' }

const deviceId = (row: WdsRecord) =>
  asString(row.DeviceID) ? <CopyValue value={String(row.DeviceID)} label="Copy the device ID" monospace /> : formatValue(row.DeviceID)

export function DevicesPage() {
  const query = useDevices()
  const bootImages = useBootImages()
  // undefined: closed; null: prestaging a new device; a record: changing that device.
  const [editing, setEditing] = useState<WdsRecord | null | undefined>(undefined)
  const [importing, setImporting] = useState(false)
  // Requests chosen for approving or rejecting together, by request ID.
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  // The tab is in the address, so the dashboard can open the requests. Without one, the page opens on the
  // requests if any are waiting when it loads; later arrivals don't switch tabs under you.
  const [params, update] = useUrlParams()
  const [firstTab, setFirstTab] = useState<string | null>(null)
  const pending = query.data?.autoAdd.filter((request) => request.Status === 'Pending').length ?? 0
  if (firstTab === null && query.data) setFirstTab(pending > 0 ? 'requests' : 'prestaged')
  const tab = params.get('tab') ?? firstTab ?? 'prestaged'
  // The search is in the address too; the box keeps its own text, as the address updates a moment later.
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  const needle = search.trim().toLowerCase()

  const bootImage = (row: WdsRecord) => {
    const path = asString(row.BootImagePath)
    return path ? bootImageName(bootImages.data ?? [], path) : formatValue(row.BootImagePath)
  }
  /** Whether a device or request matches the search, by what its row shows; IDs match whatever their separators. */
  const matches = (row: WdsRecord) => {
    if (!needle) return true
    const texts = [row.DeviceName, row.DeviceID, row.Group, row.WdsClientUnattend, row.RequestId, row.Status, row.Architecture, bootImage(row)]
    const digits = needle.replace(/[-:{}. ]/g, '')
    return (
      texts.some((value) => value != null && String(value).toLowerCase().includes(needle)) ||
      (/^[0-9a-f]{4,}$/.test(digits) && String(row.DeviceID ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase().includes(digits))
    )
  }

  // Property names are those of the WDS module's MSFT_WdsClient class.
  const prestagedColumns: RecordColumn[] = [
    { key: 'DeviceName', label: 'Name' },
    { key: 'DeviceID', label: 'Device ID', nowrap: true, render: deviceId },
    { key: 'Group', label: 'Group' },
    {
      key: 'PxePromptPolicy',
      label: 'PXE prompt',
      render: (row) =>
        devicePrompt(row) || (
          <Text size="sm" c="dimmed">
            Server's
          </Text>
        ),
    },
    { key: 'BootImagePath', label: 'Boot image', render: bootImage, sortValue: bootImage },
    { key: 'WdsClientUnattend', label: 'Client unattend' },
    {
      key: 'actions',
      label: '',
      render: (row) => (
        <DeviceActionsMenu
          device={row}
          approvedRequest={approvedRequestFor(row, query.data?.autoAdd ?? [])}
          onChange={() => setEditing(row)}
        />
      ),
    },
  ]

  const requestColumns: RecordColumn[] = [
    { key: 'RequestId', label: 'Request' },
    { key: 'DeviceName', label: 'Name' },
    { key: 'DeviceID', label: 'Device ID', nowrap: true, render: deviceId },
    { key: 'Architecture', label: 'Arch', nowrap: true },
    {
      key: 'Status',
      label: 'Status',
      render: (row) => (
        <Badge color={statusColors[String(row.Status)] ?? 'gray'} variant="light" tt="none">
          {/* What the console calls rejecting, WDS calls denying. */}
          {row.Status === 'Denied' ? 'Rejected' : formatValue(row.Status)}
        </Badge>
      ),
    },
    { key: 'BootImagePath', label: 'Boot image', render: bootImage, sortValue: bootImage },
    { key: 'actions', label: '', render: (row) => <RequestActionsMenu request={row} /> },
  ]

  const waiting = (query.data?.autoAdd ?? []).filter((request) => request.Status === 'Pending' && chosen.has(String(request.RequestId)))

  /** The list on the open tab, as filtered, as a CSV file. */
  const exportCsv = () => {
    if (!query.data) return
    if (tab === 'requests') {
      downloadCsv(datedName('device-requests'), [
        ['Request', 'Name', 'Device ID', 'Architecture', 'Status', 'Boot image'],
        ...query.data.autoAdd
          .filter(matches)
          .map((row) => [row.RequestId, row.DeviceName, row.DeviceID, row.Architecture, row.Status === 'Denied' ? 'Rejected' : row.Status, bootImage(row)]),
      ])
    } else {
      downloadCsv(datedName('devices'), [
        ['Name', 'Device ID', 'Group', 'PXE prompt', 'Boot image', 'Boot image path', 'WDS client unattend', 'Join domain'],
        ...query.data.prestaged
          .filter(matches)
          .map((row) => [
            row.DeviceName,
            row.DeviceID,
            row.Group,
            devicePrompt(row) || "Server's",
            asString(row.BootImagePath) ? bootImage(row) : '',
            row.BootImagePath,
            row.WdsClientUnattend,
            row.JoinDomain === false ? 'No' : 'Yes',
          ]),
      ])
    }
  }

  return (
    <>
      <PageHeader
        title="Devices"
        description="Prestaged devices, which WDS treats as known clients, and devices waiting for approval to boot."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        actions={
          <>
            <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => exportCsv()} disabled={!query.data}>
              Export CSV
            </Button>
            <Button variant="default" leftSection={<IconListDetails size={16} />} onClick={() => setImporting(true)}>
              Prestage from a list
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(null)}>
              Prestage device
            </Button>
          </>
        }
      />
      <TextInput
        placeholder="Search names, MAC addresses, GUIDs, groups and boot images"
        aria-label="Search devices"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(event) => {
          setSearch(event.currentTarget.value)
          update({ q: event.currentTarget.value })
        }}
        mb="md"
      />
      <QueryState query={query}>
        {(devices) => (
          <Stack>
            {devices.errors.map((error) => (
              <Alert key={error} color="yellow" icon={<IconAlertTriangle />}>
                {error}
              </Alert>
            ))}
            <Tabs value={tab} onChange={(value) => update({ tab: value })}>
              <Tabs.List>
                <Tabs.Tab value="prestaged">Prestaged ({devices.prestaged.length})</Tabs.Tab>
                <Tabs.Tab
                  value="requests"
                  rightSection={
                    pending > 0 ? (
                      <Badge color="yellow" size="sm" circle>
                        {pending}
                      </Badge>
                    ) : undefined
                  }
                >
                  Waiting for approval
                </Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="prestaged" pt="md">
                <Card withBorder p={0}>
                  <RecordTable
                    rows={devices.prestaged.filter(matches)}
                    rowKey={(row) => String(row.DeviceName)}
                    columns={prestagedColumns}
                    empty={
                      needle && devices.prestaged.length > 0
                        ? 'No prestaged devices match.'
                        : 'No prestaged devices. Prestage one here, or from a PXE boot on the Boot activity page.'
                    }
                    detailTitle={(row) => String(pick(row, 'DeviceName', 'DeviceID') ?? 'Device')}
                  />
                </Card>
              </Tabs.Panel>
              <Tabs.Panel value="requests" pt="md">
                {devices.pendingPolicyEnabled ? (
                  <Stack>
                    {(waiting.length > 0 || devices.autoAdd.some((request) => request.Status === 'Approved' || request.Status === 'Denied')) && (
                      <Group justify="space-between">
                        <Group gap="xs">
                          {waiting.length > 0 && (
                            <>
                              <Text size="sm" fw={500}>
                                {waiting.length} chosen
                              </Text>
                              <RequestBulkActions requests={waiting} onDone={() => setChosen(new Set())} />
                              <CloseButton size="sm" onClick={() => setChosen(new Set())} aria-label="Clear the choice" />
                            </>
                          )}
                        </Group>
                        <ClearRequestsButton requests={devices.autoAdd} />
                      </Group>
                    )}
                    <Card withBorder p={0}>
                      <RecordTable
                        rows={devices.autoAdd.filter(matches)}
                        rowKey={(row) => String(row.RequestId)}
                        selection={{
                          chosen,
                          onChange: setChosen,
                          // Only requests still waiting can be answered.
                          choosable: (row) => row.Status === 'Pending',
                          label: (row) => asString(row.DeviceName) || String(row.DeviceID ?? `request ${String(row.RequestId)}`),
                        }}
                        columns={requestColumns}
                        empty="No requests. Unknown clients that PXE boot wait here for approval; this list refreshes every 10 seconds."
                        detailTitle={(row) => String(pick(row, 'DeviceName', 'DeviceID') ?? 'Request')}
                      />
                    </Card>
                  </Stack>
                ) : (
                  <Alert color="blue" icon={<IconInfoCircle />}>
                    The pending-device policy is off, so unknown clients boot without waiting for approval and nothing is listed
                    here. To make them wait, set it to wait for approval under{' '}
                    <Anchor component={Link} to="/server" inherit>
                      Server settings → Pending devices
                    </Anchor>
                    .
                  </Alert>
                )}
              </Tabs.Panel>
            </Tabs>
          </Stack>
        )}
      </QueryState>
      <DeviceEditor opened={editing !== undefined} device={editing ?? null} onClose={() => setEditing(undefined)} />
      <ImportDevicesDialog opened={importing} onClose={() => setImporting(false)} />
    </>
  )
}
