import { Accordion, Alert, Button, Card, Code, Group, Modal, Progress, SimpleGrid, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPencil, IconRotateClockwise } from '@tabler/icons-react'
import { useState } from 'react'
import { useRestartWds, useServerConfig } from '../api/queries'
import type { ServerConfig, SettingsGroup } from '../api/types'
import { ConfigRows } from '../components/ConfigRows'
import { ConsoleCard } from '../components/ConsoleCard'
import { HandsFreeDialog } from '../components/HandsFreeDialog'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { SettingsEditor } from '../components/SettingsEditor'
import { EMPTY, formatBytes } from '../lib/format'
import { editorFor } from '../lib/settings'
import { findValue } from '../lib/wdsutil'

export function ServerSettingsPage() {
  const query = useServerConfig()
  const [restarting, setRestarting] = useState(false)

  return (
    <>
      <PageHeader
        title="Server settings"
        description="As reported by wdsutil /Get-Server /Show:Config. Edit a section to change it."
        onRefresh={() => void query.refetch()}
        refreshing={query.isFetching}
        actions={
          <Button variant="default" leftSection={<IconRotateClockwise size={16} />} onClick={() => setRestarting(true)}>
            Restart WDS
          </Button>
        }
      />
      <QueryState query={query}>{(config) => <Settings config={config} />}</QueryState>
      <RestartDialog opened={restarting} onClose={() => setRestarting(false)} />
    </>
  )
}

function Settings({ config }: { config: ServerConfig }) {
  const [editing, setEditing] = useState<SettingsGroup | null>(null)
  const [handsFree, setHandsFree] = useState(false)
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
          onEdit={() => setEditing('pxe')}
        />
        <Summary
          label="Hands-free deployment"
          value={handsFreeLabel(config.allowHandsFreeFunctionality)}
          detail="Blocked by default since the April 2026 update (CVE-2026-0386)"
          onEdit={() => setHandsFree(true)}
        />
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
        {policies.map((policy, index) => {
          const editor = editorFor(policy.name)
          return (
            <Card key={`${index}-${policy.name}`} withBorder padding="md">
              <Group justify="space-between" mb="xs" wrap="nowrap" align="flex-start">
                <Text fw={600}>
                  {policy.name}
                  {policy.value ? `: ${policy.value}` : ''}
                </Text>
                {editor && (
                  <Button size="compact-sm" variant="light" leftSection={<IconPencil size={14} />} onClick={() => setEditing(editor)}>
                    Edit
                  </Button>
                )}
              </Group>
              <ConfigRows nodes={policy.children} />
            </Card>
          )
        })}
      </SimpleGrid>

      <ConsoleCard />

      <Accordion variant="contained">
        <Accordion.Item value="raw">
          <Accordion.Control>Raw WDSUTIL output</Accordion.Control>
          <Accordion.Panel>
            <Code block>{config.raw}</Code>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {/* Keyed so each opening starts from the current settings. */}
      <SettingsEditor key={editing ?? 'closed'} group={editing} config={config} onClose={() => setEditing(null)} />
      <HandsFreeDialog opened={handsFree} allowed={config.allowHandsFreeFunctionality === 1} onClose={() => setHandsFree(false)} />
    </Stack>
  )
}

function RestartDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const restart = useRestartWds()

  const confirm = async () => {
    try {
      const result = await restart.mutateAsync()
      notifications.show({ color: 'green', message: `The WDS service restarted and is ${result.status.toLowerCase()}.` })
      onClose()
    } catch {
      // Shown from restart.error.
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Restart the WDS service?" centered>
      <Stack>
        <Text size="sm">
          Any PXE boot or TFTP download in progress is cut off, and clients have to boot again. Some settings, such as network interface
          changes, only take effect after a restart.
        </Text>
        {restart.error && (
          <Alert color="red" icon={<IconAlertTriangle />}>
            {restart.error.message}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="red" onClick={confirm} loading={restart.isPending}>
            Restart
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

function handsFreeLabel(value: number | null): string {
  if (value === 1) return 'Allowed (insecure override)'
  if (value === 0) return 'Blocked'
  return 'Blocked (not set)'
}

function Summary({ label, value, detail, onEdit }: { label: string; value: string; detail?: string; onEdit?: () => void }) {
  return (
    <Card withBorder padding="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
          {label}
        </Text>
        {onEdit && (
          <Button size="compact-xs" variant="subtle" onClick={onEdit}>
            Edit
          </Button>
        )}
      </Group>
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
