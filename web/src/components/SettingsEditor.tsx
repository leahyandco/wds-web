import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { useApplySettings, useBootImages } from '../api/queries'
import type { ServerConfig, SettingsGroup, WdsRecord } from '../api/types'
import { formatDuration } from '../lib/format'
import { ARCHITECTURES, bootFolder, bootsEfi, promptOptions, sameText } from '../lib/settings'
import { architectureValues, findNode, findValue, isYes, leadingNumber } from '../lib/wdsutil'

const titles: Record<SettingsGroup, string> = {
  pxe: 'PXE response',
  boot: 'Boot programs and default boot images',
  client: 'WDS client',
  'pending-devices': 'Pending devices',
  bind: 'Network interfaces',
  transport: 'TFTP and multicast',
}

const NONE = '\u0000none'

interface FormProps {
  config: ServerConfig
  onDone: () => void
}

/** A form for one group of server settings, prefilled from the current WDSUTIL report. */
export function SettingsEditor({ group, config, onClose }: { group: SettingsGroup | null; config: ServerConfig; onClose: () => void }) {
  return (
    <Modal opened={group !== null} onClose={onClose} title={group ? titles[group] : ''} size={group === 'boot' || group === 'bind' ? 'xl' : 'lg'}>
      {group === 'pxe' && <PxeForm config={config} onDone={onClose} />}
      {group === 'boot' && <BootForm config={config} onDone={onClose} />}
      {group === 'client' && <ClientForm config={config} onDone={onClose} />}
      {group === 'pending-devices' && <PendingDevicesForm config={config} onDone={onClose} />}
      {group === 'bind' && <BindForm config={config} onDone={onClose} />}
      {group === 'transport' && <TransportForm config={config} onDone={onClose} />}
    </Modal>
  )
}

/** Save and Cancel for a settings form, reporting WDSUTIL's answer. */
function SettingsForm({
  group,
  body,
  onDone,
  unchanged = false,
  problem,
  children,
}: {
  group: SettingsGroup
  body: unknown
  onDone: () => void
  unchanged?: boolean
  /** Why the form can't be saved as it stands. */
  problem?: string | null
  children: ReactNode
}) {
  const apply = useApplySettings()

  const save = async () => {
    try {
      const result = await apply.mutateAsync({ group, body })
      // WDSUTIL mostly just says it worked; show anything else it said, such as a restart being needed.
      const notes = result.applied.map((a) => a.message).filter((m) => m && !/completed successfully/i.test(m))
      notifications.show({
        color: 'green',
        title: `${titles[group]} saved`,
        message: notes.length > 0 ? notes.join(' ') : `WDSUTIL applied ${result.applied.length} change${result.applied.length === 1 ? '' : 's'}.`,
      })
      onDone()
    } catch {
      // Shown from apply.error.
    }
  }

  return (
    <Stack>
      {children}
      {problem && (
        <Alert color="yellow" icon={<IconAlertTriangle />}>
          {problem}
        </Alert>
      )}
      {apply.error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {apply.error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} loading={apply.isPending} disabled={unchanged || !!problem}>
          Save
        </Button>
      </Group>
    </Stack>
  )
}

function PxeForm({ config, onDone }: FormProps) {
  const s = config.sections
  const initialAnswer = !isYes(findValue(s, ['Answer Policy', 'Answer clients']))
    ? 'None'
    : isYes(findValue(s, ['Answer Policy', 'Answer only known clients']))
      ? 'Known'
      : 'All'
  const [answer, setAnswer] = useState(initialAnswer)
  const [delay, setDelay] = useState<number | string>(leadingNumber(findValue(s, ['Answer Policy', 'Response delay']), 0))
  const [known, setKnown] = useState(findValue(s, ['Boot Program Policy', 'Known client PXE prompt policy']) ?? 'OptIn')
  const [fresh, setFresh] = useState(findValue(s, ['Boot Program Policy', 'New client PXE prompt policy']) ?? 'OptIn')

  return (
    <SettingsForm
      group="pxe"
      body={{ answerClients: answer, responseDelay: Number(delay), knownClientPrompt: known, newClientPrompt: fresh }}
      onDone={onDone}
    >
      <div>
        <Text size="sm" fw={500} mb={4}>
          Answer PXE requests from
        </Text>
        <SegmentedControl
          fullWidth
          value={answer}
          onChange={setAnswer}
          data={[
            { value: 'All', label: 'All clients' },
            { value: 'Known', label: 'Prestaged clients only' },
            { value: 'None', label: 'Nobody' },
          ]}
        />
      </div>
      <NumberInput label="Response delay" description="Seconds to wait before answering a client that isn't prestaged" min={0} max={300} value={delay} onChange={setDelay} suffix=" s" />
      <Select label="Prestaged clients" data={promptOptions} value={known} onChange={(v) => v && setKnown(v)} allowDeselect={false} />
      <Select label="New clients" data={promptOptions} value={fresh} onChange={(v) => v && setFresh(v)} allowDeselect={false} />
    </SettingsForm>
  )
}

// The form's starting choices come from the boot image list, so wait for it.
function BootForm(props: FormProps) {
  const bootImages = useBootImages()
  if (bootImages.isPending) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }
  return <BootFields {...props} bootImages={bootImages.data ?? []} />
}

function BootFields({ config, onDone, bootImages }: FormProps & { bootImages: WdsRecord[] }) {
  const s = config.sections
  const programs = architectureValues(s, ['Boot Program Policy', 'Default boot programs'])
  const images = architectureValues(s, ['Boot Image Policy', 'Default boot images'])
  const initialType = findValue(s, ['Boot Image Policy', 'Default image type for x64 clients']) ?? 'Both'

  const programChoices = (architecture: string) => {
    const folder = `boot\\${bootFolder(architecture)}\\`
    const extensions = bootsEfi(architecture) ? ['.efi'] : ['.com', '.n12']
    const files = config.bootPrograms.filter((p) => {
      const path = p.toLowerCase()
      return path.startsWith(folder) && !path.slice(folder.length).includes('\\') && extensions.some((e) => path.endsWith(e))
    })
    const current = programs[architecture]
    return current && !files.some((f) => sameText(f, current)) ? [current, ...files] : files
  }
  const imageChoices = (architecture: string) => {
    const cimArchitecture = architecture.startsWith('x64') ? 'X64' : architecture.startsWith('x86') ? 'X86' : 'Arm'
    const paths = bootImages
      .filter((image) => image.Architecture === cimArchitecture)
      .map((image) => ({ value: `Boot\\${bootFolder(architecture)}\\Images\\${String(image.FileName)}`, label: String(image.Name) }))
    const current = images[architecture]
    if (current && !paths.some((p) => sameText(p.value, current))) paths.unshift({ value: current, label: current })
    return [{ value: NONE, label: 'None: clients choose from the boot menu' }, ...paths]
  }
  // Select wants exact values; the report's spelling can differ in case from the file list's.
  const matchOption = (options: string[], value: string | null) => options.find((o) => sameText(o, value)) ?? value ?? ''

  const [program, setProgram] = useState<Record<string, string>>(() =>
    Object.fromEntries(ARCHITECTURES.map((a) => [a, matchOption(programChoices(a), programs[a])])),
  )
  const [image, setImage] = useState<Record<string, string>>(() =>
    Object.fromEntries(ARCHITECTURES.map((a) => [a, images[a] ? matchOption(imageChoices(a).map((o) => o.value), images[a]) : NONE])),
  )
  const [imageType, setImageType] = useState(initialType)

  const changes = ARCHITECTURES.map((a) => ({
    architecture: a,
    bootProgram: program[a] && !sameText(program[a], programs[a]) ? program[a] : null,
    bootImage: (image[a] === NONE ? '' : image[a]).toLowerCase() !== (images[a] ?? '').toLowerCase() ? (image[a] === NONE ? '' : image[a]) : null,
  })).filter((c) => c.bootProgram !== null || c.bootImage !== null)
  const typeChanged = !sameText(imageType, initialType)

  return (
    <SettingsForm
      group="boot"
      body={{ architectures: changes, x64ImageType: typeChanged ? imageType : null }}
      onDone={onDone}
      unchanged={changes.length === 0 && !typeChanged}
    >
      <Text size="sm" c="dimmed">
        The boot program is what a client downloads first. With a default boot image, clients skip the boot menu and load that image
        straight away. Prompts (F12) are under PXE response.
      </Text>
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Architecture</Table.Th>
            <Table.Th>Boot program</Table.Th>
            <Table.Th>Default boot image</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {ARCHITECTURES.map((architecture) => {
            const choices = programChoices(architecture)
            return (
              <Table.Tr key={architecture}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {architecture}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Select
                    data={choices}
                    value={program[architecture] || null}
                    onChange={(v) => v && setProgram({ ...program, [architecture]: v })}
                    allowDeselect={false}
                    placeholder={choices.length === 0 ? 'No boot programs for this architecture' : undefined}
                    disabled={choices.length === 0}
                    comboboxProps={{ withinPortal: true }}
                  />
                </Table.Td>
                <Table.Td>
                  <Select
                    data={imageChoices(architecture)}
                    value={image[architecture]}
                    onChange={(v) => v && setImage({ ...image, [architecture]: v })}
                    allowDeselect={false}
                    comboboxProps={{ withinPortal: true }}
                  />
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
      <div>
        <Text size="sm" fw={500} mb={4}>
          Boot images offered to x64 clients
        </Text>
        <SegmentedControl
          value={imageType}
          onChange={setImageType}
          data={[
            { value: 'Both', label: 'x86 and x64' },
            { value: 'x64', label: 'x64 only' },
            { value: 'x86', label: 'x86 only' },
          ]}
        />
      </div>
    </SettingsForm>
  )
}

function ClientForm({ config, onDone }: FormProps) {
  const s = config.sections
  const logging = ['WDS Client Policy', 'Logging policy']
  const unattend = ['WDS Client Policy', 'Unattend policy']
  const files = architectureValues(s, [...unattend, 'WDS unattend files'])

  const [loggingEnabled, setLoggingEnabled] = useState(isYes(findValue(s, [...logging, 'Enabled'])))
  const [level, setLevel] = useState(findValue(s, [...logging, 'Logging level']) ?? 'Info')
  const [unattendEnabled, setUnattendEnabled] = useState(isYes(findValue(s, [...unattend, 'Enabled'])))
  const [precedence, setPrecedence] = useState(isYes(findValue(s, [...unattend, 'Command-line precedence'])))
  const [fileFor, setFileFor] = useState<Record<string, string>>(() => Object.fromEntries(ARCHITECTURES.map((a) => [a, files[a] ?? ''])))

  const changedFiles = ARCHITECTURES.filter((a) => fileFor[a].trim() !== (files[a] ?? '')).map((a) => ({ architecture: a, file: fileFor[a].trim() }))
  const handsFreeBlocked = unattendEnabled && config.allowHandsFreeFunctionality !== 1

  return (
    <SettingsForm
      group="client"
      body={{ loggingEnabled, loggingLevel: level, unattendEnabled, commandLinePrecedence: precedence, unattendFiles: changedFiles }}
      onDone={onDone}
    >
      <Switch
        label="Log WDS client actions on the server"
        description="Clients running Windows Setup in WDS mode report image selection and progress to the Deployment-Services-Diagnostics log"
        checked={loggingEnabled}
        onChange={(e) => setLoggingEnabled(e.currentTarget.checked)}
      />
      <Select
        label="Logging level"
        data={['None', 'Errors', 'Warnings', 'Info']}
        value={level}
        onChange={(v) => v && setLevel(v)}
        allowDeselect={false}
        disabled={!loggingEnabled}
      />
      <Switch
        label="Unattended WDS client"
        description="Give clients an unattend file for the WDS client (language, credentials, which image)"
        checked={unattendEnabled}
        onChange={(e) => setUnattendEnabled(e.currentTarget.checked)}
      />
      <Switch
        label="Let a client's own unattend file take precedence"
        checked={precedence}
        onChange={(e) => setPrecedence(e.currentTarget.checked)}
        disabled={!unattendEnabled}
      />
      <Stack gap="xs">
        <Text size="sm" fw={500}>
          Unattend file per architecture, relative to RemoteInstall
        </Text>
        {ARCHITECTURES.map((a) => (
          <TextInput
            key={a}
            label={a}
            placeholder={`WdsClientUnattend\\${a}.xml`}
            value={fileFor[a]}
            onChange={(e) => setFileFor({ ...fileFor, [a]: e.currentTarget.value })}
            disabled={!unattendEnabled}
            size="xs"
          />
        ))}
      </Stack>
      {handsFreeBlocked && (
        <Alert color="yellow" icon={<IconAlertTriangle />}>
          Since the April 2026 security update (CVE-2026-0386), WDS doesn't give clients these unattend files unless its hands-free
          override is on, and this server doesn't have it on.
        </Alert>
      )}
    </SettingsForm>
  )
}

function PendingDevicesForm({ config, onDone }: FormProps) {
  const s = config.sections
  const p = ['Pending Device Policy']
  const [policy, setPolicy] = useState((findValue(s, [...p, 'Policy']) ?? '').toLowerCase().startsWith('admin') ? 'AdminApproval' : 'Disabled')
  const [poll, setPoll] = useState<number | string>(leadingNumber(findValue(s, [...p, 'Poll interval']), 10))
  const [retries, setRetries] = useState<number | string>(leadingNumber(findValue(s, [...p, 'Max retry count']), 2160))
  const [message, setMessage] = useState(findValue(s, [...p, 'Message to pending clients']) ?? '')
  const [approved, setApproved] = useState<number | string>(leadingNumber(findValue(s, [...p, 'Retention period', 'Approved devices']), 30))
  const [others, setOthers] = useState<number | string>(leadingNumber(findValue(s, [...p, 'Retention period', 'Other devices']), 1))

  return (
    <SettingsForm
      group="pending-devices"
      body={{
        policy,
        pollInterval: Number(poll),
        maxRetry: Number(retries),
        message,
        approvedRetentionDays: Number(approved),
        otherRetentionDays: Number(others),
      }}
      onDone={onDone}
      problem={/["\r\n]/.test(message) ? 'The message can’t contain quotes or line breaks.' : null}
    >
      <div>
        <Text size="sm" fw={500} mb={4}>
          Unknown clients
        </Text>
        <SegmentedControl
          fullWidth
          value={policy}
          onChange={setPolicy}
          data={[
            { value: 'Disabled', label: 'Boot straight away' },
            { value: 'AdminApproval', label: 'Wait for approval on the Devices page' },
          ]}
        />
      </div>
      <Group grow>
        <NumberInput label="Check every" min={1} max={3600} value={poll} onChange={setPoll} suffix=" s" />
        <NumberInput label="Up to" min={1} max={100000} value={retries} onChange={setRetries} suffix=" times" />
      </Group>
      <Text size="xs" c="dimmed">
        A waiting client gives up after {formatDuration(Number(poll) * Number(retries))}.
      </Text>
      <TextInput label="Message shown to waiting clients" maxLength={256} value={message} onChange={(e) => setMessage(e.currentTarget.value)} />
      <Group grow>
        <NumberInput label="Keep approved requests" min={1} max={3650} value={approved} onChange={setApproved} suffix=" days" />
        <NumberInput label="Keep other requests" min={1} max={3650} value={others} onChange={setOthers} suffix=" days" />
      </Group>
    </SettingsForm>
  )
}

const hexOf = (mac: string) => mac.replace(/[^0-9a-f]/gi, '').toUpperCase()

function BindForm({ config, onDone }: FormProps) {
  const s = config.sections
  const initialPolicy = (findValue(s, ['Interface Bind Policy', 'Policy']) ?? '').toLowerCase().startsWith('include') ? 'Include' : 'Exclude'
  const registered = (findNode(s, ['Interface Bind Policy', 'Registered interfaces'])?.children ?? []).map((n) => ({
    type: n.name.toUpperCase(),
    address: n.value ?? '',
  }))
  const matches = (entry: { type: string; address: string }, iface: ServerConfig['interfaces'][number]) =>
    entry.type === 'MAC' ? !!iface.macAddress && hexOf(iface.macAddress) === hexOf(entry.address) : entry.address === iface.ipAddress
  const wasRegistered = (iface: ServerConfig['interfaces'][number]) => registered.some((r) => matches(r, iface))
  const stale = registered.filter((r) => !config.interfaces.some((iface) => matches(r, iface)))

  const [policy, setPolicy] = useState(initialPolicy)
  const [ticked, setTicked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(config.interfaces.map((iface) => [iface.ipAddress, wasRegistered(iface)])),
  )
  const [keepStale, setKeepStale] = useState<Record<string, boolean>>(() => Object.fromEntries(stale.map((r) => [r.address, true])))

  const add = config.interfaces
    .filter((iface) => ticked[iface.ipAddress] && !wasRegistered(iface))
    .map((iface) => (iface.macAddress ? { address: iface.macAddress, type: 'MAC' } : { address: iface.ipAddress, type: 'IP' }))
  const remove = [
    ...registered.filter((r) => config.interfaces.some((iface) => matches(r, iface) && !ticked[iface.ipAddress])),
    ...stale.filter((r) => !keepStale[r.address]),
  ].map((r) => ({ address: r.address, type: r.type }))
  const tickedCount = Object.values(ticked).filter(Boolean).length + Object.values(keepStale).filter(Boolean).length

  return (
    <SettingsForm
      group="bind"
      body={{ policy, add, remove }}
      onDone={onDone}
      unchanged={policy === initialPolicy && add.length === 0 && remove.length === 0}
      problem={policy === 'Include' && tickedCount === 0 ? 'Tick at least one interface, or WDS won’t listen on any.' : null}
    >
      <SegmentedControl
        fullWidth
        value={policy}
        onChange={setPolicy}
        data={[
          { value: 'Exclude', label: 'Listen on every interface except the ticked ones' },
          { value: 'Include', label: 'Listen only on the ticked interfaces' },
        ]}
      />
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40} />
            <Table.Th>Interface</Table.Th>
            <Table.Th>IPv4</Table.Th>
            <Table.Th>MAC</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {config.interfaces.map((iface) => (
            <Table.Tr key={iface.ipAddress}>
              <Table.Td>
                <Checkbox
                  aria-label={`Tick ${iface.name}`}
                  checked={!!ticked[iface.ipAddress]}
                  onChange={(e) => setTicked({ ...ticked, [iface.ipAddress]: e.currentTarget.checked })}
                />
              </Table.Td>
              <Table.Td>
                <Text size="sm">{iface.name}</Text>
                <Group gap={4}>
                  {iface.status && iface.status !== 'Up' && (
                    <Badge size="xs" variant="light" color="gray" tt="none">
                      {iface.status}
                    </Badge>
                  )}
                  {iface.ipAddress.startsWith('169.254.') && (
                    <Badge size="xs" variant="light" color="yellow" tt="none">
                      No network address
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{iface.ipAddress}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" ff="monospace">
                  {iface.macAddress ?? '—'}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
          {stale.map((entry) => (
            <Table.Tr key={entry.address}>
              <Table.Td>
                <Checkbox
                  aria-label={`Keep ${entry.address}`}
                  checked={!!keepStale[entry.address]}
                  onChange={(e) => setKeepStale({ ...keepStale, [entry.address]: e.currentTarget.checked })}
                />
              </Table.Td>
              <Table.Td colSpan={3}>
                <Text size="sm" c="dimmed">
                  Registered {entry.type} {entry.address}, which doesn't match any interface now
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        Interfaces with a MAC address are registered by MAC, so they stay matched when their IP changes; the rest by IP.
      </Text>
    </SettingsForm>
  )
}

function TransportForm({ config, onDone }: FormProps) {
  const s = config.sections
  const tftp = ['WDS Transport Server Policy', 'TFTP Properties']
  const multicast = ['WDS Transport Server Policy', 'Multicast session policy']
  const [blockSize, setBlockSize] = useState<number | string>(leadingNumber(findValue(s, [...tftp, 'Maximum block size']), 0))
  const [variableWindow, setVariableWindow] = useState(isYes(findValue(s, [...tftp, 'Variable window extension enabled'])))
  const [policy, setPolicy] = useState(findValue(s, [...multicast, 'Slow client handling policy']) ?? 'None')
  const [threshold, setThreshold] = useState<number | string>(leadingNumber(findValue(s, [...multicast, 'AutoDisconnect threshold']), 256))
  const [streams, setStreams] = useState(String(leadingNumber(findValue(s, [...multicast, 'Multistream stream count']), 2)))
  const [fallback, setFallback] = useState(isYes(findValue(s, [...multicast, 'Slow client fallback'])))

  return (
    <SettingsForm
      group="transport"
      body={{
        tftpMaximumBlockSize: Number(blockSize),
        tftpVariableWindowExtension: variableWindow,
        multicastPolicy: policy,
        autoDisconnectThreshold: Number(threshold),
        streamCount: Number(streams),
        fallback,
      }}
      onDone={onDone}
    >
      <NumberInput
        label="TFTP maximum block size"
        description="0 lets WDS choose; otherwise 512 to 16384 bytes"
        min={0}
        max={16384}
        value={blockSize}
        onChange={setBlockSize}
      />
      <Switch
        label="TFTP variable window extension"
        description="Speeds up boot image downloads. If clients fail TFTP downloads (event 4101), turning it off can help."
        checked={variableWindow}
        onChange={(e) => setVariableWindow(e.currentTarget.checked)}
      />
      <Select
        label="Slow multicast clients"
        data={[
          { value: 'None', label: 'Keep everyone in one session' },
          { value: 'AutoDisconnect', label: 'Disconnect clients below a speed' },
          { value: 'Multistream', label: 'Split clients into sessions by speed' },
        ]}
        value={policy}
        onChange={(v) => v && setPolicy(v)}
        allowDeselect={false}
      />
      {policy === 'AutoDisconnect' && (
        <NumberInput label="Disconnect below" min={1} max={1048576} value={threshold} onChange={setThreshold} suffix=" KBps" />
      )}
      {policy === 'Multistream' && (
        <SegmentedControl value={streams} onChange={setStreams} data={[{ value: '2', label: '2 sessions' }, { value: '3', label: '3 sessions' }]} />
      )}
      <Switch
        label="Let disconnected clients fall back to unicast"
        checked={fallback}
        onChange={(e) => setFallback(e.currentTarget.checked)}
      />
    </SettingsForm>
  )
}
