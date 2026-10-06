import { ActionIcon, Button, Group, Menu, Modal, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconDots, IconPencil, IconPlayerPause, IconPlayerPlay, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useImageAction, type ImageAction } from '../api/queries'
import type { ImageKind, WdsRecord } from '../api/types'
import { ImagePropertiesDialog } from './ImagePropertiesDialog'

const pastTense: Record<ImageAction, string> = { enable: 'Enabled', disable: 'Disabled', remove: 'Removed' }

/** Change, enable, disable or remove one boot or install image, confirming before a removal. */
export function ImageActionsMenu({ kind, image }: { kind: ImageKind; image: WdsRecord }) {
  const action = useImageAction()
  const [dialog, setDialog] = useState<'properties' | 'remove' | null>(null)
  const name = String(image.Name)

  const run = async (verb: ImageAction) => {
    try {
      await action.mutateAsync({
        kind,
        action: verb,
        name,
        architecture: kind === 'boot' ? String(image.Architecture) : undefined,
        imageGroup: kind === 'install' ? String(image.ImageGroup) : undefined,
        fileName: typeof image.FileName === 'string' ? image.FileName : undefined,
      })
      notifications.show({ color: 'green', message: `${pastTense[verb]} ${name}` })
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
