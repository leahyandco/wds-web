import { Accordion, Alert, Card, Code, Progress, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useServerConfig } from '../api/queries'
import type { ServerConfig } from '../api/types'
import { ConfigRows } from '../components/ConfigRows'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { EMPTY, formatBytes } from '../lib/format'
import { findValue } from '../lib/wdsutil'

export function ServerSettingsPage() {
  const query = useServerConfig()

  return (
    <>
      <PageHeader
        title="Server settings"
        description="As reported by wdsutil /Get-Server /Show:Config."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
      />
      <QueryState query={query}>{(config) => <Settings config={config} />}</QueryState>
    </>
  )
}

function Settings({ config }: { config: ServerConfig }) {
  const standalone = findValue(config.sections, ['Server State', 'Standalone configuration'])
  const answerClients = findValue(config.sections, ['Answer Policy', 'Answer clients'])
  const knownOnly = findValue(config.sections, ['Answer Policy', 'Answer only known clients'])
  const policies = config.sections.flatMap((section) => section.children)
  const usedPercent = config.remoteInstall
    ? 100 - (config.remoteInstall.freeBytes / config.remoteInstall.totalBytes) * 100
    : 0

  return (
    <Stack gap="lg">
      {config.wdsUtilExitCode !== 0 && (
        <Alert color="red" icon={<IconAlertTriangle />} title={`WDSUTIL exited with code ${config.wdsUtilExitCode}`}>
          Its output is under "Raw WDSUTIL output" below.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <Summary
          label="Mode"
          value={standalone === 'Yes' ? 'Standalone' : standalone === 'No' ? 'Active Directory' : (standalone ?? EMPTY)}
        />
        <Summary
          label="Answers PXE clients"
          value={answerClients === 'No' ? 'No' : answerClients === 'Yes' ? (knownOnly === 'Yes' ? 'Known clients only' : 'All clients') : EMPTY}
        />
        <Summary label="Hands-free deployment" value={handsFreeLabel(config.allowHandsFreeFunctionality)} detail="Blocked by default since the April 2026 update (CVE-2026-0386)" />
        <Card withBorder padding="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            RemoteInstall
          </Text>
          {config.remoteInstall ? (
            <>
              <Text fw={600} mt={4} style={{ wordBreak: 'break-all' }}>
                {config.remoteInstall.path}
              </Text>
              <Progress
                mt="sm"
                value={usedPercent}
                color={usedPercent > 90 ? 'red' : usedPercent > 75 ? 'yellow' : 'blue'}
                aria-label="Volume used"
              />
              <Text size="xs" c="dimmed" mt={4}>
                {formatBytes(config.remoteInstall.freeBytes)} free of {formatBytes(config.remoteInstall.totalBytes)}
              </Text>
            </>
          ) : (
            <Text fw={600} mt={4}>
              Not found
            </Text>
          )}
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {policies.map((policy, index) => (
          <Card key={`${index}-${policy.name}`} withBorder padding="md">
            <Text fw={600} mb="xs">
              {policy.name}
              {policy.value ? `: ${policy.value}` : ''}
            </Text>
            <ConfigRows nodes={policy.children} />
          </Card>
        ))}
      </SimpleGrid>

      <Accordion variant="contained">
        <Accordion.Item value="raw">
          <Accordion.Control>Raw WDSUTIL output</Accordion.Control>
          <Accordion.Panel>
            <Code block>{config.raw}</Code>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  )
}

function handsFreeLabel(value: number | null): string {
  if (value === 1) return 'Allowed (insecure override)'
  if (value === 0) return 'Blocked'
  return 'Not set'
}

function Summary({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card withBorder padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fw={600} mt={4}>
        {value}
      </Text>
      {detail && (
        <Text size="xs" c="dimmed" mt={4}>
          {detail}
        </Text>
      )}
    </Card>
  )
}
