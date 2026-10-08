import { Alert, Anchor, Badge, Button, Card, Group, Stack, Tabs, Text } from '@mantine/core'
import { IconAlertTriangle, IconInfoCircle, IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useDevices } from '../api/queries'
import type { WdsRecord } from '../api/types'
import { DeviceEditor } from '../components/DeviceEditor'
import { ClearRequestsButton, DeviceActionsMenu, RequestActionsMenu } from '../components/DeviceMenus'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable, type RecordColumn } from '../components/RecordTable'
import { approvedRequestFor, devicePrompt } from '../lib/devices'
import { formatValue } from '../lib/format'
import { pick } from '../lib/records'

const statusColors: Record<string, string> = { Pending: 'yellow', Approved: 'green', Denied: 'red' }

const monospace = (value: unknown) => (
  <Text size="sm" ff="monospace">
    {formatValue(value)}
  </Text>
)

// Property names are those of the WDS module's MSFT_WdsClient class.
const requestColumns: RecordColumn[] = [
  { key: 'RequestId', label: 'Request' },
  { key: 'DeviceName', label: 'Name' },
  { key: 'DeviceID', label: 'Device ID', nowrap: true, render: (row) => monospace(row.DeviceID) },
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
  { key: 'BootImagePath', label: 'Boot image' },
  { key: 'actions', label: '', render: (row) => <RequestActionsMenu request={row} /> },
]

export function DevicesPage() {
  const query = useDevices()
  // undefined: closed; null: prestaging a new device; a record: changing that device.
  const [editing, setEditing] = useState<WdsRecord | null | undefined>(undefined)

  const prestagedColumns: RecordColumn[] = [
    { key: 'DeviceName', label: 'Name' },
    { key: 'DeviceID', label: 'Device ID', nowrap: true, render: (row) => monospace(row.DeviceID) },
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
    { key: 'BootImagePath', label: 'Boot image' },
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
        {(devices) => {
          const pending = devices.autoAdd.filter((request) => request.Status === 'Pending').length
          return (
            <Stack>
              {devices.errors.map((error) => (
                <Alert key={error} color="yellow" icon={<IconAlertTriangle />}>
                  {error}
                </Alert>
              ))}
              <Tabs defaultValue={pending > 0 ? 'requests' : 'prestaged'}>
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
                          columns={requestColumns}
                          empty="No requests. Unknown clients that PXE boot wait here for approval."
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
          )
        }}
      </QueryState>
      <DeviceEditor opened={editing !== undefined} device={editing ?? null} onClose={() => setEditing(undefined)} />
    </>
  )
}
