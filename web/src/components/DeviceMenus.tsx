import { ActionIcon, Alert, Button, Group, Loader, Menu, Modal, Select, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconCheck, IconDots, IconPencil, IconTrash, IconX } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { useAnswerDeviceRequest, useBootImages, useRemoveDevice } from '../api/queries'
import type { WdsRecord } from '../api/types'
import { bootImageChoices, isDeviceName } from '../lib/devices'
import { asNumber } from '../lib/records'

const NONE = '\u0000none'

const failed = (title: string, error: unknown) =>
  notifications.show({ color: 'red', title, message: error instanceof Error ? error.message : String(error) })

/** The rows open their details on click; keep clicks here, and in the portalled dialogs, from reaching them. */
function RowMenu({ label, busy, children, dialogs }: { label: string; busy: boolean; children: ReactNode; dialogs: ReactNode }) {
  return (
    <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${label}`} loading={busy}>
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>{children}</Menu.Dropdown>
      </Menu>
      {dialogs}
    </div>
  )
}

/** Change or remove one prestaged device; changing opens the page's device editor. */
export function DeviceActionsMenu({ device, onChange }: { device: WdsRecord; onChange: () => void }) {
  const remove = useRemoveDevice()
  const [confirming, setConfirming] = useState(false)
  const name = String(device.DeviceName)

  const removeDevice = async () => {
    try {
      await remove.mutateAsync(name)
      notifications.show({ color: 'green', message: `Removed ${name}` })
      setConfirming(false)
    } catch (error) {
      failed(`Couldn't remove ${name}`, error)
    }
  }

  return (
    <RowMenu
      label={name}
      busy={remove.isPending}
      dialogs={
        <Modal opened={confirming} onClose={() => setConfirming(false)} title={`Remove ${name}?`} centered>
          <Text size="sm">
            WDS forgets the device. The next time it PXE boots it's an unknown client, which WDS answers only if PXE response allows
            all clients.
          </Text>
          <Group justify="flex-end" mt="lg">
            <Button variant="default" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button color="red" loading={remove.isPending} onClick={removeDevice}>
              Remove
            </Button>
          </Group>
        </Modal>
      }
    >
      <Menu.Item leftSection={<IconPencil size={14} />} onClick={onChange}>
        Change…
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => setConfirming(true)}>
        Remove…
      </Menu.Item>
    </RowMenu>
  )
}

/** Approve or reject a request from a device waiting for approval. Answered requests have no menu. */
export function RequestActionsMenu({ request }: { request: WdsRecord }) {
  const answer = useAnswerDeviceRequest()
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const requestId = asNumber(request.RequestId)
  if (requestId === null || request.Status !== 'Pending') return null
  const label = String(request.DeviceName ?? request.DeviceID ?? `request ${requestId}`)

  const reject = async () => {
    try {
      await answer.mutateAsync({ requestId, approval: 'reject' })
      notifications.show({ color: 'green', message: `Rejected ${label}` })
      setDialog(null)
    } catch (error) {
      failed(`Couldn't reject ${label}`, error)
    }
  }

  return (
    <RowMenu
      label={label}
      busy={answer.isPending}
      dialogs={
        <>
          <Modal opened={dialog === 'approve'} onClose={() => setDialog(null)} title={`Approve ${label}`} centered size="lg">
            {dialog === 'approve' && <ApproveForm requestId={requestId} label={label} onDone={() => setDialog(null)} />}
          </Modal>
          <Modal opened={dialog === 'reject'} onClose={() => setDialog(null)} title={`Reject ${label}?`} centered>
            <Text size="sm">
              WDS tells the waiting client no, and it stops network booting. The request stays on the list as rejected for the
              retention period set under Pending devices.
            </Text>
            <Group justify="flex-end" mt="lg">
              <Button variant="default" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button color="red" loading={answer.isPending} onClick={reject}>
                Reject
              </Button>
            </Group>
          </Modal>
        </>
      }
    >
      <Menu.Item leftSection={<IconCheck size={14} />} onClick={() => setDialog('approve')}>
        Approve…
      </Menu.Item>
      <Menu.Item color="red" leftSection={<IconX size={14} />} onClick={() => setDialog('reject')}>
        Reject…
      </Menu.Item>
    </RowMenu>
  )
}

function ApproveForm({ requestId, label, onDone }: { requestId: number; label: string; onDone: () => void }) {
  const answer = useAnswerDeviceRequest()
  const bootImages = useBootImages()
  const [name, setName] = useState('')
  const [bootImage, setBootImage] = useState('')
  const [unattend, setUnattend] = useState('')

  if (bootImages.isPending) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }
  const images = bootImageChoices(bootImages.data ?? [], '')
  const nameProblem = name.trim() && !isDeviceName(name) ? 'Use letters, digits, hyphens and underscores, without spaces.' : null

  const approve = async () => {
    try {
      await answer.mutateAsync({
        requestId,
        approval: { name: name.trim() || null, bootImagePath: bootImage || null, wdsClientUnattend: unattend.trim() || null },
      })
      notifications.show({ color: 'green', message: `Approved ${label}. It carries on booting at its next check.` })
      onDone()
    } catch {
      // Shown from the mutation's error.
    }
  }

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        The client is waiting at its PXE screen and carries on booting the next time it checks. Anything left empty follows the
        server's settings.
      </Text>
      <TextInput
        label="Name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        error={nameProblem}
        description="Leave empty to let WDS name it."
        data-autofocus
      />
      <Select
        label="Boot image"
        data={[{ value: NONE, label: "The boot menu, or the server's default boot image" }, ...images.choices]}
        value={bootImage || NONE}
        onChange={(v) => setBootImage(!v || v === NONE ? '' : v)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      <TextInput
        label="WDS client unattend file"
        value={unattend}
        onChange={(e) => setUnattend(e.currentTarget.value)}
        placeholder="WdsClientUnattend\x64.xml"
        description="Relative to RemoteInstall."
      />
      {answer.error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {answer.error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={approve} loading={answer.isPending} disabled={!!nameProblem}>
          Approve
        </Button>
      </Group>
    </Stack>
  )
}
