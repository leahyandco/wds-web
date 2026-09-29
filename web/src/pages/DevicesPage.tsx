import { Alert, Badge, Card, Stack, Tabs } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useDevices } from '../api/queries'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable, type RecordColumn } from '../components/RecordTable'
import { formatValue } from '../lib/format'
import { pick } from '../lib/records'

const statusColors: Record<string, string> = { Pending: 'yellow', Approved: 'green', Denied: 'red' }

// Property names are those of the WDS module's MSFT_WdsClient class.
const autoAddColumns: RecordColumn[] = [
  { key: 'RequestId', label: 'Request' },
  { key: 'DeviceName', label: 'Name' },
  { key: 'DeviceID', label: 'Device ID' },
  { key: 'Architecture', label: 'Arch', nowrap: true },
  {
    key: 'Status',
    label: 'Status',
    render: (row) => (
      <Badge color={statusColors[String(row.Status)] ?? 'gray'} variant="light" tt="none">
        {formatValue(row.Status)}
      </Badge>
    ),
  },
  { key: 'BootImagePath', label: 'Boot image' },
  { key: 'ReferralServer', label: 'Referral server' },
]

const prestagedColumns: RecordColumn[] = [
  { key: 'DeviceName', label: 'Name' },
  { key: 'DeviceID', label: 'Device ID' },
  { key: 'Architecture', label: 'Arch' },
  { key: 'Group', label: 'Group' },
  { key: 'BootImagePath', label: 'Boot image' },
  { key: 'PxePromptPolicy', label: 'PXE prompt' },
  { key: 'WdsClientUnattend', label: 'Client unattend' },
]

export function DevicesPage() {
  const query = useDevices()

  return (
    <>
      <PageHeader
        title="Devices"
        description="Prestaged devices, and devices that asked to boot while the pending-device policy required approval."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />
      <QueryState query={query}>
        {(devices) => (
          <Stack>
            {devices.errors.map((error) => (
              <Alert key={error} color="yellow" icon={<IconAlertTriangle />}>
                {error}
              </Alert>
            ))}
            <Tabs defaultValue="requests">
              <Tabs.List>
                <Tabs.Tab value="requests">Pending device requests ({devices.autoAdd.length})</Tabs.Tab>
                <Tabs.Tab value="prestaged">Prestaged ({devices.prestaged.length})</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="requests" pt="md">
                <Card withBorder p={0}>
                  <RecordTable
                    rows={devices.autoAdd}
                    columns={autoAddColumns}
                    empty="No device requests. WDS only records them when the pending-device policy requires approval."
                    detailTitle={(row) => String(pick(row, 'DeviceName', 'DeviceID') ?? 'Request')}
                  />
                </Card>
              </Tabs.Panel>
              <Tabs.Panel value="prestaged" pt="md">
                <Card withBorder p={0}>
                  <RecordTable
                    rows={devices.prestaged}
                    columns={prestagedColumns}
                    empty="No prestaged devices."
                    detailTitle={(row) => String(pick(row, 'DeviceName', 'DeviceID') ?? 'Device')}
                  />
                </Card>
              </Tabs.Panel>
            </Tabs>
          </Stack>
        )}
      </QueryState>
    </>
  )
}
