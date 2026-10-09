import { ActionIcon, Alert, Button, Group, Menu, Modal, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconDots, IconPencil, IconPlayerPause, IconPlayerPlay, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useDevices, useImageAction, useServerConfig, type ImageAction } from '../api/queries'
import type { ImageKind, WdsRecord } from '../api/types'
import { showDone } from '../lib/notify'
import { asString } from '../lib/records'
import { sameText } from '../lib/settings'
import { architectureValues } from '../lib/wdsutil'
import { ImagePropertiesDialog } from './ImagePropertiesDialog'

const pastTense: Record<ImageAction, string> = { enable: 'Enabled', disable: 'Disabled', remove: 'Removed' }

/** Change, enable, disable or remove one boot or install image, confirming before a removal. */
export function ImageActionsMenu({ kind, image }: { kind: ImageKind; image: WdsRecord }) {
  const action = useImageAction()
  const [dialog, setDialog] = useState<'properties' | 'remove' | null>(null)
  const name = String(image.Name)

  const target = {
    kind,
    name,
    architecture: kind === 'boot' ? String(image.Architecture) : undefined,
    imageGroup: kind === 'install' ? String(image.ImageGroup) : undefined,
    fileName: typeof image.FileName === 'string' ? image.FileName : undefined,
  }

  const run = async (verb: ImageAction) => {
    try {
      await action.mutateAsync({ ...target, action: verb })
      // Enabling and disabling can be undone; removing can't.
      const opposite = verb === 'enable' ? 'disable' : verb === 'disable' ? 'enable' : null
      showDone(`${pastTense[verb]} ${name}`, opposite ? () => action.mutateAsync({ ...target, action: opposite }) : undefined)
      return true
    } catch (error) {
      notifications.show({ color: 'red', title: `Couldn't ${verb} ${name}`, message: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  return (
    // The row opens its details on click; keep clicks here (and in the portalled modals) from reaching it.
    <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${name}`} loading={action.isPending}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setDialog('properties')}>
            Properties…
          </Menu.Item>
          {image.Enabled === false ? (
            <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={() => void run('enable')}>
              Enable
            </Menu.Item>
          ) : (
            <Menu.Item leftSection={<IconPlayerPause size={14} />} onClick={() => void run('disable')}>
              Disable
            </Menu.Item>
          )}
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => setDialog('remove')}>
            Remove…
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <ImagePropertiesDialog kind={kind} image={image} opened={dialog === 'properties'} onClose={() => setDialog(null)} />

      <Modal opened={dialog === 'remove'} onClose={() => setDialog(null)} title={`Remove ${name}?`} centered>
        <Text size="sm">
          {kind === 'boot'
            ? 'WDS deletes the boot image, and PXE clients can no longer boot it.'
            : 'WDS removes the image from its group. Other images in the group are kept.'}{' '}
          The file it was imported from isn't touched.
        </Text>
        {kind === 'boot' && dialog === 'remove' && <BootImageUsers image={image} />}
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={action.isPending}
            onClick={async () => {
              if (await run('remove')) setDialog(null)
            }}
          >
            Remove
          </Button>
        </Group>
      </Modal>
    </div>
  )
}

/** What still points at a boot image: prestaged devices sent straight to it, and the server's default boot images. */
function BootImageUsers({ image }: { image: WdsRecord }) {
  const devices = useDevices()
  const config = useServerConfig()
  const path = `Boot\\${String(image.Architecture).toLowerCase()}\\Images\\${String(image.FileName)}`
  const same = (value: string | null | undefined) => sameText(value?.replace(/^\\/, ''), path)
  const sentHere = (devices.data?.prestaged ?? []).filter((device) => same(asString(device.BootImagePath)))
  const defaultFor = config.data
    ? Object.entries(architectureValues(config.data.sections, ['Boot Image Policy', 'Default boot images']))
        .filter(([, value]) => same(value))
        .map(([architecture]) => architecture)
    : []
  if (sentHere.length === 0 && defaultFor.length === 0) return null

  return (
    <Alert color="orange" icon={<IconAlertTriangle />} mt="md" title="Still in use">
      {sentHere.length > 0 && (
        <Text size="sm">
          {sentHere.length === 1 ? 'This prestaged device is' : 'These prestaged devices are'} sent straight to it:{' '}
          {sentHere.map((device) => String(device.DeviceName)).join(', ')}. Change {sentHere.length === 1 ? 'it' : 'them'} on
          the Devices page first, or {sentHere.length === 1 ? 'it' : 'they'}'ll be sent to an image that's gone.
        </Text>
      )}
      {defaultFor.length > 0 && (
        <Text size="sm" mt={sentHere.length > 0 ? 'xs' : 0}>
          It's the default boot image for {defaultFor.join(', ')} clients, under Server settings → Boot image policy.
        </Text>
      )}
    </Alert>
  )
}
