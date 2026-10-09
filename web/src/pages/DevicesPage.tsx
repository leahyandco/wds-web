import { Alert, Anchor, Badge, Button, Card, Group, Stack, Tabs, Text } from '@mantine/core'
import { IconAlertTriangle, IconInfoCircle, IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useBootImages, useDevices } from '../api/queries'
import type { WdsRecord } from '../api/types'
import { CopyValue } from '../components/Copy'
import { DeviceEditor } from '../components/DeviceEditor'
import { ClearRequestsButton, DeviceActionsMenu, RequestActionsMenu } from '../components/DeviceMenus'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable, type RecordColumn } from '../components/RecordTable'
import { approvedRequestFor, bootImageName, devicePrompt } from '../lib/devices'
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
  // The tab is in the address, so the dashboard can open the requests. Without one, the page opens on the
  // requests if any are waiting when it loads; later arrivals don't switch tabs under you.
  const [params, update] = useUrlParams()
  const [firstTab, setFirstTab] = useState<string | null>(null)
  const pending = query.data?.autoAdd.filter((request) => request.Status === 'Pending').length ?? 0
  if (firstTab === null && query.data) setFirstTab(pending > 0 ? 'requests' : 'prestaged')
  const tab = params.get('tab') ?? firstTab ?? 'prestaged'

  const bootImage = (row: WdsRecord) => {
    const path = asString(row.BootImagePath)
    return path ? bootImageName(bootImages.data ?? [], path) : formatValue(row.BootImagePath)
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
    { key: 'BootImagePath', label: 'Boot image', render: bootImage },
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
    { key: 'BootImagePath', label: 'Boot image', render: bootImage },
    { key: 'actions', label: '', render: (row) => <RequestActionsMenu request={row} /> },
  ]

  return (
    <>
      <PageHeader
        title="Devices"
        description="Prestaged devices, which WDS treats as known clients, and devices waiting for approval to boot."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(null)}>
            Prestage device
          </Button>
        }
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
                    rows={devices.prestaged}
                    rowKey={(row) => String(row.DeviceName)}
                    columns={prestagedColumns}
                    empty="No prestaged devices. Prestage one here, or from a PXE boot on the Boot activity page."
                    detailTitle={(row) => String(pick(row, 'DeviceName', 'DeviceID') ?? 'Device')}
                  />
                </Card>
              </Tabs.Panel>
              <Tabs.Panel value="requests" pt="md">
                {devices.pendingPolicyEnabled ? (
                  <Stack>
                    {devices.autoAdd.some((request) => request.Status === 'Approved' || request.Status === 'Denied') && (
                      <Group justify="flex-end">
                        <ClearRequestsButton requests={devices.autoAdd} />
                      </Group>
                    )}
                    <Card withBorder p={0}>
                      <RecordTable
                        rows={devices.autoAdd}
                        rowKey={(row) => String(row.RequestId)}
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
    </>
  )
}
