import { Accordion, Alert, Anchor, Button, Card, Code, Group, List, Modal, Progress, SimpleGrid, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconPencil, IconRotateClockwise } from '@tabler/icons-react'
import { useState } from 'react'
import { useActivity, useDevices, useRestartWds, useServerConfig } from '../api/queries'
import type { ServerConfig, SettingsGroup } from '../api/types'
import { ConfigRows } from '../components/ConfigRows'
import { ConsoleCard } from '../components/ConsoleCard'
import { CopyCode } from '../components/Copy'
import { HandsFreeDialog } from '../components/HandsFreeDialog'
import { PageHeader } from '../components/PageHeader'
import { QueryState } from '../components/QueryState'
import { SettingsEditor } from '../components/SettingsEditor'
import { StagedUploadsCard } from '../components/StagedUploadsCard'
import { clientAddress } from '../lib/boot'
import { deploymentStage } from '../lib/deployments'
import { prestagedDevice } from '../lib/devices'
import { EMPTY, formatBytes } from '../lib/format'
import { ARCHITECTURES, editorFor } from '../lib/settings'
import { useNow } from '../lib/useNow'
import { findValue, isYes } from '../lib/wdsutil'

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

      {/* A long page: jump straight to a policy. */}
      <Group gap="xs" wrap="wrap">
        <Text size="sm" c="dimmed">
          Jump to:
        </Text>
        {policies.map((policy, index) => (
          <Anchor
            key={`${index}-${policy.name}`}
            size="sm"
            href={`#${policyId(policy.name)}`}
            onClick={(event) => {
              event.preventDefault()
              document.getElementById(policyId(policy.name))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {policy.name}
          </Anchor>
        ))}
      </Group>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {policies.map((policy, index) => {
          const editor = editorFor(policy.name)
          return (
            <Card key={`${index}-${policy.name}`} id={policyId(policy.name)} withBorder padding="md" style={{ scrollMarginTop: 72 }}>
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
              {policy.name === 'Pending Device Policy' && standalone === 'Yes' && <JoinDomainDefaults config={config} />}
            </Card>
          )
        })}
      </SimpleGrid>

      <ConsoleCard />

      <StagedUploadsCard />

      <Accordion variant="contained">
        <Accordion.Item value="raw">
          <Accordion.Control>Raw WDSUTIL output</Accordion.Control>
          <Accordion.Panel>
            <CopyCode value={config.raw} label="Copy the WDSUTIL output" />
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
  const activity = useActivity(24)
  const devices = useDevices()
  // Clients a restart would cut off: downloading a boot image, or installing, and heard from lately.
  const recent = useNow(60_000) - 30 * 60_000
  const busy = (activity.data?.sessions ?? []).filter(
    (session) =>
      new Date(session.lastSeen).getTime() > recent &&
      (session.status === 'downloading' || (session.deployment && session.deployment.stage !== 'finished' && session.deployment.stage !== 'failed')),
  )

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
        {busy.length > 0 && (
          <Alert color="orange" icon={<IconAlertTriangle />} title={`${busy.length === 1 ? 'A client is' : `${busy.length} clients are`} busy with WDS`}>
            <List size="sm" spacing={2}>
              {busy.map((session) => {
                const device = prestagedDevice(devices.data?.prestaged ?? [], session.macAddress, session.deviceId)
                return (
                  <List.Item key={session.id}>
                    {device ? String(device.DeviceName) : (session.macAddress ?? clientAddress(session))}:{' '}
                    {session.deployment ? deploymentStage[session.deployment.stage].label.toLowerCase() : 'downloading a boot image'}
                  </List.Item>
                )
              })}
            </List>
            <Text size="sm" mt={4}>
              A restart now interrupts {busy.length === 1 ? 'it' : 'them'}.
            </Text>
          </Alert>
        )}
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

/** The ID a policy's card goes by, for jumping to it: "Pending Device Policy" → "policy-pending-device-policy". */
const policyId = (name: string) => `policy-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

/**
 * WDS's defaults for devices approved outside this console (in the WDS snap-in, say) join them to a domain,
 * which a standalone server doesn't have, so their installs end with a failed join. Approving on the Devices
 * page here turns joining off; the defaults can be changed with WDSUTIL.
 */
function JoinDomainDefaults({ config }: { config: ServerConfig }) {
  const joining = ARCHITECTURES.filter((architecture) => isYes(findValue(config.sections, ['Pending Device Policy', `Defaults for ${architecture}`, 'Join domain'])))
  if (joining.length === 0) return null
  return (
    <Alert color="orange" icon={<IconAlertTriangle />} mt="sm" title="Approved devices join a domain by default">
      <Text size="sm">
        This server is standalone, but its defaults for {joining.join(', ')} clients have devices approved elsewhere, such as in the WDS
        snap-in, join a domain, so their installs end with a failed join. Devices approved on the Devices page here don't join. To change
        the defaults, run this on the WDS server for each architecture:
      </Text>
      <Code block mt="xs">
        {joining.map((architecture) => `wdsutil /Set-Server /AutoAddSettings /Architecture:${architecture} /JoinDomain:No`).join('\n')}
      </Code>
    </Alert>
  )
}
