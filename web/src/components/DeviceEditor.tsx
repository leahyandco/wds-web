import { Alert, Button, Group, Loader, Modal, SegmentedControl, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useState } from 'react'
import { useAddDevice, useBootImages, useChangeDevice, useServerConfig } from '../api/queries'
import type { DeviceChanges, WdsRecord } from '../api/types'
import { bootImageChoices, devicePrompt, isDeviceId, isDeviceName, isPlaceholderGuid } from '../lib/devices'
import { asString } from '../lib/records'
import { promptOptions, sameText } from '../lib/settings'
import { findValue } from '../lib/wdsutil'

const NONE = '\u0000none'

/** The IDs a client reported when it PXE booted, offered when prestaging it. */
export interface DeviceSeed {
  guid?: string | null
  mac?: string | null
}

interface DeviceEditorProps {
  opened: boolean
  /** The device to change; null to prestage a new one. */
  device: WdsRecord | null
  seed?: DeviceSeed
  onClose: () => void
}

/** Prestages a device, or changes one's ID, group, PXE prompt, boot image, WDS client unattend file and domain join. */
export function DeviceEditor({ opened, device, seed, onClose }: DeviceEditorProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={device ? `Change ${String(device.DeviceName)}` : 'Prestage a device'} size="lg">
      {/* Mounted only while open, so each opening starts from the device as it is now. */}
      {opened && <DeviceFormLoader device={device} seed={seed} onDone={onClose} />}
    </Modal>
  )
}

interface DeviceFormProps {
  device: WdsRecord | null
  seed?: DeviceSeed
  onDone: () => void
}

// The boot image choice starts from the boot image list, and the domain join from the server's mode, so wait for both.
function DeviceFormLoader(props: DeviceFormProps) {
  const bootImages = useBootImages()
  const config = useServerConfig()
  if (bootImages.isPending || config.isPending) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }
  const standalone = config.data ? findValue(config.data.sections, ['Server State', 'Standalone configuration']) === 'Yes' : false
  return <DeviceForm {...props} bootImages={bootImages.data ?? []} standalone={standalone} />
}

interface JoinDomainSwitchProps {
  checked: boolean
  onChange: (join: boolean) => void
  standalone: boolean
}

/** The domain join switch; a standalone server has no domain, and a join there only fails at the end of the install. */
export function JoinDomainSwitch({ checked, onChange, standalone }: JoinDomainSwitchProps) {
  return (
    <Switch
      label="Join the domain during setup"
      checked={checked}
      onChange={(e) => onChange(e.currentTarget.checked)}
      description={
        standalone
          ? "This WDS server is standalone, so there's no domain to join: leave this off, or the install ends with a failed join."
          : 'The WDS client joins the computer to the domain under its name.'
      }
    />
  )
}

function DeviceForm({ device, seed, onDone, bootImages, standalone }: DeviceFormProps & { bootImages: WdsRecord[]; standalone: boolean }) {
  const add = useAddDevice()
  const change = useChangeDevice()
  const error = add.error ?? change.error

  const usableGuid = seed?.guid && !isPlaceholderGuid(seed.guid) ? seed.guid : null
  const initial = {
    name: device ? String(device.DeviceName ?? '') : '',
    deviceId: device ? String(device.DeviceID ?? '') : (usableGuid ?? seed?.mac ?? ''),
    group: (device && asString(device.Group)) ?? '',
    prompt: device ? devicePrompt(device) : '',
    bootImage: (device && asString(device.BootImagePath)) ?? '',
    unattend: (device && asString(device.WdsClientUnattend)) ?? '',
    // WDS joins prestaged devices to the domain unless told not to.
    joinDomain: device ? device.JoinDomain !== false : !standalone,
  }
  const [name, setName] = useState(initial.name)
  const [deviceId, setDeviceId] = useState(initial.deviceId)
  const [group, setGroup] = useState(initial.group)
  const [prompt, setPrompt] = useState(initial.prompt)
  const images = bootImageChoices(bootImages, initial.bootImage)
  const [bootImage, setBootImage] = useState(images.selected)
  const [unattend, setUnattend] = useState(initial.unattend)
  const [joinDomain, setJoinDomain] = useState(initial.joinDomain)

  const nameProblem = name.trim() && !isDeviceName(name) ? 'Use letters, digits, hyphens and underscores, without spaces.' : null
  const idProblem = deviceId.trim() && !isDeviceId(deviceId) ? 'Enter a MAC address or a GUID with dashes.' : null
  const changes: DeviceChanges = {
    deviceId: sameText(deviceId.trim(), initial.deviceId) ? null : deviceId.trim(),
    group: group.trim() === initial.group ? null : group.trim(),
    pxePromptPolicy: prompt === initial.prompt ? null : prompt,
    bootImagePath: sameText(bootImage, initial.bootImage) ? null : bootImage,
    wdsClientUnattend: sameText(unattend.trim(), initial.unattend) ? null : unattend.trim(),
    joinDomain: joinDomain === initial.joinDomain ? null : joinDomain,
  }
  const ready = device
    ? Object.values(changes).some((value) => value !== null) && !idProblem
    : isDeviceName(name) && isDeviceId(deviceId)

  const save = async () => {
    try {
      if (device) {
        await change.mutateAsync({ name: initial.name, changes })
        notifications.show({ color: 'green', message: `Saved ${initial.name}` })
      } else {
        await add.mutateAsync({
          name: name.trim(),
          deviceId: deviceId.trim(),
          group: group.trim() || null,
          pxePromptPolicy: prompt || null,
          bootImagePath: bootImage || null,
          wdsClientUnattend: unattend.trim() || null,
          joinDomain,
        })
        notifications.show({ color: 'green', message: `Prestaged ${name.trim()}` })
      }
      onDone()
    } catch {
      // Shown from the mutation's error.
    }
  }

  return (
    <Stack>
      <TextInput
        label="Name"
        required={!device}
        disabled={!!device}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        error={nameProblem}
        description={device ? "WDS can't rename a device. Remove it and prestage it again instead." : 'As in a computer name.'}
        data-autofocus
      />
      {!device && usableGuid && seed?.mac && (
        <div>
          <Text size="sm" fw={500}>
            Identify it by
          </Text>
          <Text size="xs" c="dimmed" mb={6}>
            The GUID belongs to the machine. The MAC address belongs to its network adapter, so it moves with a USB adapter.
          </Text>
          <SegmentedControl
            value={deviceId}
            onChange={setDeviceId}
            data={[
              { value: usableGuid, label: 'SMBIOS GUID' },
              { value: seed.mac, label: 'MAC address' },
            ]}
          />
        </div>
      )}
      <TextInput
        label="Device ID"
        required
        value={deviceId}
        onChange={(e) => setDeviceId(e.currentTarget.value)}
        error={idProblem}
        description="The MAC address, or the SMBIOS GUID, the client reports when it PXE boots. Boot activity shows both."
        placeholder="00-B0-56-88-2F-DC or {E8A3EFAC-201F-4E69-953E-B2DAA1E8B1B6}"
        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
      />
      <TextInput label="Group" value={group} onChange={(e) => setGroup(e.currentTarget.value)} description="Optional, for your own sorting." />
      <Select
        label="PXE prompt"
        data={[{ value: NONE, label: "The server's policy for known clients" }, ...promptOptions]}
        value={prompt || NONE}
        onChange={(v) => setPrompt(!v || v === NONE ? '' : v)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      <Select
        label="Boot image"
        data={[{ value: NONE, label: "The boot menu, or the server's default boot image" }, ...images.choices]}
        value={bootImage || NONE}
        onChange={(v) => setBootImage(!v || v === NONE ? '' : v)}
        description="WDS still shows its boot menu, with this image chosen when the menu's countdown ends."
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
      <JoinDomainSwitch checked={joinDomain} onChange={setJoinDomain} standalone={standalone} />
      {error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} loading={add.isPending || change.isPending} disabled={!ready}>
          {device ? 'Save' : 'Prestage'}
        </Button>
      </Group>
    </Stack>
  )
}
