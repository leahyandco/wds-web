import { Alert, Card, Stack, Tabs } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useDevices } from '../api/queries'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { RecordTable } from '../components/RecordTable'
import { autoColumns, pick } from '../lib/records'

const autoAddColumns = ['RequestId', 'DeviceName', 'DeviceId', 'MacAddress', 'Architecture', 'Status', 'ClientIpAddress']
const prestagedColumns = ['DeviceName', 'DeviceId', 'BootImagePath', 'ReferralServer', 'PxePromptPolicy', 'JoinDomain']

export function DevicesPage() {
  const query = useDevices()

  return (
    <>
      <PageHeader
        title="Devices"
        description="Prestaged devices, and devices that asked to boot while the auto-add policy required approval."
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
            <Tabs defaultValue="auto-add">
              <Tabs.List>
                <Tabs.Tab value="auto-add">Auto-add requests ({devices.autoAdd.length})</Tabs.Tab>
                <Tabs.Tab value="prestaged">Prestaged ({devices.prestaged.length})</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="auto-add" pt="md">
                <Card withBorder p={0}>
                  <RecordTable
                    rows={devices.autoAdd}
                    columns={autoColumns(devices.autoAdd, autoAddColumns)}
                    empty="No auto-add requests."
                    detailTitle={(row) => String(pick(row, 'DeviceName', 'RequestId') ?? 'Request')}
                  />
                </Card>
              </Tabs.Panel>
              <Tabs.Panel value="prestaged" pt="md">
                <Card withBorder p={0}>
                  <RecordTable
                    rows={devices.prestaged}
                    columns={autoColumns(devices.prestaged, prestagedColumns)}
                    empty="No prestaged devices."
                    detailTitle={(row) => String(pick(row, 'DeviceName', 'DeviceId') ?? 'Device')}
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
