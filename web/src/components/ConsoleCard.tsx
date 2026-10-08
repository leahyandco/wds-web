import { Alert, Badge, Card, Code, Group, Loader, Stack, Table, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { useConsoleInfo } from '../api/queries'

/** How this console is set up, read-only: changing it means editing settings.json or rerunning the installer. */
export function ConsoleCard() {
  const query = useConsoleInfo()
  const info = query.data

  return (
    <Card withBorder padding="md">
      <Text fw={600} mb="xs">
        This console
      </Text>
      {query.isPending && <Loader size="sm" />}
      {query.error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {query.error.message}
        </Alert>
      )}
      {info && (
        <Stack gap="sm">
          <Table withRowBorders={false} verticalSpacing={4}>
            <Table.Tbody>
              <Row label="Version">{info.version}</Row>
              <Row label="Manages">
                {info.mode === 'remote'
                  ? `${info.server}, over WinRM from ${info.consoleHost} (Remote mode)`
                  : `WDS on ${info.server}, where the console runs (Local mode)`}
              </Row>
              <Row label="Connects as">{info.connectsAs}</Row>
              <Row label="Staging folder">
                {info.stagingPath}
                {info.stagingAccess !== info.stagingPath && (
                  <Text span size="sm" c="dimmed">
                    {' '}
                    (reached as {info.stagingAccess})
                  </Text>
                )}
              </Row>
              <Row label="Who can sign in">
                {!info.signInRequired ? (
                  <Badge color="red" variant="light" tt="none">
                    Sign-in is turned off
                  </Badge>
                ) : (
                  <Group gap={6}>
                    {info.allowedAccounts.map((account) => (
                      <Badge
                        key={`${account.kind}:${account.name}`}
                        variant="light"
                        color={account.resolved ? 'blue' : 'red'}
                        tt="none"
                        title={account.problem ?? (account.kind === 'group' ? 'Members of this group' : 'This account')}
                      >
                        {account.name}
                        {account.kind === 'user' ? ' (user)' : ''}
                        {account.resolved ? '' : ': not found'}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Row>
              <Row label="Sessions last">{formatLifetime(info.sessionLifetime)}</Row>
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed">
            To change these, edit <Code>{info.settingsFile}</Code>
            {info.settingsFileExists ? '' : ' (not created yet)'} and restart the WdsWeb service, or run Install-WdsWeb.ps1 again with new
            parameters. The README lists every setting.
          </Text>
        </Stack>
      )}
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Table.Tr>
      <Table.Td w={160} style={{ verticalAlign: 'top' }}>
        <Text size="sm" c="dimmed">
          {label}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm" component="div">
          {children}
        </Text>
      </Table.Td>
    </Table.Tr>
  )
}

/** "08:00:00" as "8 hours", "1.00:00:00" as "24 hours". */
function formatLifetime(timeSpan: string) {
  const match = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)/.exec(timeSpan)
  if (!match) return timeSpan
  const hours = Number(match[1] ?? 0) * 24 + Number(match[2])
  const minutes = Number(match[3])
  return minutes === 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours} h ${minutes} min`
}
