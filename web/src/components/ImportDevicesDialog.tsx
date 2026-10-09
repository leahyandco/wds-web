import { Alert, Badge, Button, FileInput, Group, Loader, Modal, ScrollArea, Select, Table, Text, Textarea, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconFileText } from '@tabler/icons-react'
import { useState } from 'react'
import { useAddDevice, useBootImages, useDevices, useServerConfig } from '../api/queries'
import type { WdsRecord } from '../api/types'
import { parseCsv } from '../lib/csv'
import { bootImageChoices, isDeviceId, isDeviceName, isPlaceholderGuid, prestagedDevice } from '../lib/devices'
import { promptOptions, sameText } from '../lib/settings'
import { findValue } from '../lib/wdsutil'
import { JoinDomainSwitch } from './DeviceEditor'
import { DialogForm } from './DialogForm'

const NONE = '\u0000none'

/** One line of the list, and what's wrong with it, if anything. */
interface DeviceLine {
  line: number
  name: string
  deviceId: string
  group: string
  problem: string | null
}

/**
 * Reads a list of devices: a name and a MAC address or GUID on each line, and optionally a group. A header
 * row can name the columns in any order; without one they're taken as name, ID, group.
 */
function readDeviceList(text: string, existing: WdsRecord[]): DeviceLine[] {
  const table = parseCsv(text)
  if (table.length === 0) return []
  const header = table[0].map((cell) => cell.toLowerCase())
  const hasHeader = header.some((cell) => /name|computer|host/.test(cell)) && header.some((cell) => /mac|guid|\bid\b/.test(cell))
  const column = (pattern: RegExp, fallback: number) => (hasHeader ? header.findIndex((cell) => pattern.test(cell)) : fallback)
  const nameColumn = column(/name|computer|host/, 0)
  const idColumn = column(/mac|guid|\bid\b/, 1)
  const groupColumn = column(/group/, 2)

  const names = new Set<string>()
  const ids = new Set<string>()
  return (hasHeader ? table.slice(1) : table).map((cells, index) => {
    const name = cells[nameColumn] ?? ''
    const deviceId = cells[idColumn] ?? ''
    const group = groupColumn >= 0 ? (cells[groupColumn] ?? '') : ''
    const idKey = deviceId.replace(/[^0-9a-f]/gi, '').toUpperCase()
    const already = prestagedDevice(existing, deviceId)
    let problem: string | null = null
    if (!name) problem = 'No name'
    else if (!isDeviceName(name)) problem = 'Names take letters, digits, hyphens and underscores'
    else if (!deviceId) problem = 'No MAC address or GUID'
    else if (!isDeviceId(deviceId)) problem = 'Not a MAC address or a GUID with dashes'
    else if (isPlaceholderGuid(deviceId)) problem = 'A placeholder GUID that many machines share; use the MAC address'
    else if (names.has(name.toLowerCase()) || ids.has(idKey)) problem = 'Listed twice'
    else if (existing.some((device) => sameText(String(device.DeviceName), name))) problem = 'A device has this name already'
    else if (already) problem = `Prestaged already, as ${String(already.DeviceName)}`
    names.add(name.toLowerCase())
    ids.add(idKey)
    return { line: index + (hasHeader ? 2 : 1), name, deviceId, group, problem }
  })
}

/** Prestages many devices at once, from a pasted list or a .csv file, with the same settings for all. */
export function ImportDevicesDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Prestage devices from a list" size="xl" closeOnClickOutside={false}>
      {/* Mounted only while open, so each opening starts empty. */}
      {opened && <ImportDevicesForm onDone={onClose} />}
    </Modal>
  )
}

function ImportDevicesForm({ onDone }: { onDone: () => void }) {
  const devices = useDevices()
  const bootImages = useBootImages()
  const config = useServerConfig()
  const add = useAddDevice()
  const [text, setText] = useState('')
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  const [bootImage, setBootImage] = useState('')
  const [prompt, setPrompt] = useState('')
  const [unattend, setUnattend] = useState('')
  const [joinDomain, setJoinDomain] = useState<boolean | null>(null)
  // Once started, the list as it was then, and how each line went: true, or why it failed.
  const [started, setStarted] = useState<DeviceLine[] | null>(null)
  const [outcomes, setOutcomes] = useState<Map<number, true | string>>(new Map())
  const [running, setRunning] = useState(false)

  if (devices.isPending || bootImages.isPending || config.isPending) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  const standalone = config.data ? findValue(config.data.sections, ['Server State', 'Standalone configuration']) === 'Yes' : false
  const join = joinDomain ?? !standalone
  const lines = started ?? readDeviceList(text, devices.data?.prestaged ?? [])
  const ready = lines.filter((line) => line.problem === null)
  const images = bootImageChoices(bootImages.data ?? [], '')

  const readFile = async (file: File | null) => {
    setFileProblem(null)
    if (!file) return
    if (file.size > 2_000_000) {
      setFileProblem('That file is too big for a list of devices.')
      return
    }
    setText(await file.text())
  }

  const prestage = async () => {
    setStarted(lines)
    setRunning(true)
    const results = new Map<number, true | string>()
    for (const line of ready) {
      try {
        await add.mutateAsync({
          name: line.name,
          deviceId: line.deviceId,
          group: line.group || null,
          pxePromptPolicy: prompt || null,
          bootImagePath: bootImage || null,
          wdsClientUnattend: unattend.trim() || null,
          joinDomain: join,
        })
        results.set(line.line, true)
      } catch (error) {
        results.set(line.line, error instanceof Error ? error.message : String(error))
      }
      setOutcomes(new Map(results))
    }
    setRunning(false)
    const succeeded = [...results.values()].filter((result) => result === true).length
    if (succeeded > 0) notifications.show({ color: 'green', message: `Prestaged ${succeeded} device${succeeded === 1 ? '' : 's'}` })
    if (succeeded === results.size) onDone()
  }

  const finished = started !== null && !running

  return (
    <DialogForm onSubmit={() => void prestage()} canSubmit={started === null && ready.length > 0}>
      {started === null && (
        <>
          <Text size="sm" c="dimmed">
            One device a line: its name, then its MAC address or SMBIOS GUID, and optionally a group, separated by commas or
            tabs (as copied from a spreadsheet). A header row can name the columns instead, such as Name, MAC, Group.
          </Text>
          <Group align="flex-end" gap="sm">
            <FileInput
              label="From a file"
              placeholder="Choose a .csv or .txt file"
              accept=".csv,.txt,text/csv,text/plain"
              leftSection={<IconFileText size={16} />}
              onChange={(file) => void readFile(file)}
              error={fileProblem}
              clearable
              style={{ flex: 1 }}
            />
          </Group>
          <Textarea
            label="Or paste the list"
            placeholder={'LAB-PC-21,00-00-5E-00-53-21,Lab\nLAB-PC-22,00-00-5E-00-53-22,Lab'}
            autosize
            minRows={4}
            maxRows={10}
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            data-autofocus
          />
        </>
      )}

      {lines.length > 0 && (
        <ScrollArea.Autosize mah={260} type="auto">
          <Table verticalSpacing={4} striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Line</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>MAC address or GUID</Table.Th>
                <Table.Th>Group</Table.Th>
                <Table.Th>{started ? 'Result' : 'Check'}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((line) => {
                const outcome = outcomes.get(line.line)
                return (
                  <Table.Tr key={line.line}>
                    <Table.Td>{line.line}</Table.Td>
                    <Table.Td>{line.name}</Table.Td>
                    <Table.Td ff="monospace">{line.deviceId}</Table.Td>
                    <Table.Td>{line.group}</Table.Td>
                    <Table.Td>
                      {outcome === true ? (
                        <Badge color="green" variant="light" tt="none">
                          Prestaged
                        </Badge>
                      ) : outcome ? (
                        <Text size="sm" c="red">
                          {outcome}
                        </Text>
                      ) : line.problem ? (
                        <Text size="sm" c="orange">
                          {line.problem}
                        </Text>
                      ) : running ? (
                        <Loader size={14} />
                      ) : (
                        <Badge color="blue" variant="light" tt="none">
                          Ready
                        </Badge>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}

      {started === null && (
        <>
          <Text size="sm" fw={500}>
            For all of them
          </Text>
          <Select
            label="Boot image"
            data={[{ value: NONE, label: "The boot menu, or the server's default boot image" }, ...images.choices]}
            value={bootImage || NONE}
            onChange={(v) => setBootImage(!v || v === NONE ? '' : v)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <Select
            label="PXE prompt"
            data={[{ value: NONE, label: "The server's policy for known clients" }, ...promptOptions]}
            value={prompt || NONE}
            onChange={(v) => setPrompt(!v || v === NONE ? '' : v)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <TextInput
            label="WDS client unattend file"
            value={unattend}
            onChange={(e) => setUnattend(e.currentTarget.value)}
            placeholder="WdsClientUnattend\x64.xml"
            description="Relative to RemoteInstall. Leave empty to use the server's."
          />
          <JoinDomainSwitch checked={join} onChange={setJoinDomain} standalone={standalone} />
        </>
      )}

      {finished && [...outcomes.values()].some((outcome) => outcome !== true) && (
        <Alert color="orange" icon={<IconAlertTriangle />}>
          {[...outcomes.values()].some((outcome) => outcome === true)
            ? "Some devices couldn't be prestaged; the list says why. The rest are prestaged."
            : "None of them could be prestaged; the list says why."}
        </Alert>
      )}

      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {lines.length > 0 && started === null
            ? `${ready.length} of ${lines.length} ready${lines.length > ready.length ? '; lines with problems are skipped' : ''}`
            : ''}
        </Text>
        <Group gap="sm">
          <Button variant="default" onClick={onDone} disabled={running}>
            {finished ? 'Close' : 'Cancel'}
          </Button>
          {!finished && (
            <Button type="submit" loading={running} disabled={ready.length === 0}>
              Prestage {ready.length > 0 ? ready.length : ''} device{ready.length === 1 ? '' : 's'}
            </Button>
          )}
        </Group>
      </Group>
    </DialogForm>
  )
}
