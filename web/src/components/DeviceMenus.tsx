import { ActionIcon, Alert, Button, Checkbox, Group, Loader, Menu, Modal, Select, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconCheck, IconClearAll, IconDots, IconPencil, IconTrash, IconX } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { useAnswerDeviceRequest, useBootImages, useClearDeviceRequests, useRemoveDevice, useServerConfig } from '../api/queries'
import type { WdsRecord } from '../api/types'
import { bootImageChoices, isDeviceName } from '../lib/devices'
import { asNumber, asString } from '../lib/records'
import { findValue } from '../lib/wdsutil'
import { JoinDomainSwitch } from './DeviceEditor'

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

interface DeviceActionsMenuProps {
  device: WdsRecord
  /** The approved request the device came from, if WDS still keeps it. */
  approvedRequest?: WdsRecord
  onChange: () => void
}

/** Change or remove one prestaged device; changing opens the page's device editor. */
export function DeviceActionsMenu({ device, approvedRequest, onChange }: DeviceActionsMenuProps) {
  const remove = useRemoveDevice()
  const clear = useClearDeviceRequests()
  const [confirming, setConfirming] = useState(false)
  const [clearApproved, setClearApproved] = useState(true)
  const name = String(device.DeviceName)

  const removeDevice = async () => {
    try {
      await remove.mutateAsync(name)
      if (approvedRequest && clearApproved) await clear.mutateAsync({ approved: true, rejected: false })
      notifications.show({ color: 'green', message: `Removed ${name}` })
      setConfirming(false)
    } catch (error) {
      failed(`Couldn't remove ${name}`, error)
    }
  }

  return (
    <RowMenu
      label={name}
      busy={remove.isPending || clear.isPending}
      dialogs={
        <Modal opened={confirming} onClose={() => setConfirming(false)} title={`Remove ${name}?`} centered>
          <Text size="sm">
            WDS forgets the device. The next time it PXE boots it's an unknown client, which WDS answers only if PXE response allows
            all clients.
          </Text>
          {approvedRequest && (
            <Stack gap="xs" mt="md">
              <Text size="sm">
                WDS still keeps the request this device was approved from (request {String(approvedRequest.RequestId)}). Until that
                expires, WDS won't answer the device at all, not even to ask for approval again.
              </Text>
              <Checkbox
                label="Also clear approved requests"
                description="WDS can only clear them all at once. The devices approved from them stay prestaged."
                checked={clearApproved}
                onChange={(e) => setClearApproved(e.currentTarget.checked)}
              />
            </Stack>
          )}
          <Group justify="flex-end" mt="lg">
            <Button variant="default" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button color="red" loading={remove.isPending || clear.isPending} onClick={removeDevice}>
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
  // WDS reports an unnamed request's name as an empty string.
  const label = asString(request.DeviceName) || asString(request.DeviceID) || `request ${requestId}`

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
  const config = useServerConfig()
  const [name, setName] = useState('')
  const [bootImage, setBootImage] = useState('')
  const [unattend, setUnattend] = useState('')
  const [joinDomain, setJoinDomain] = useState<boolean | null>(null)

  if (bootImages.isPending || config.isPending) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }
  const images = bootImageChoices(bootImages.data ?? [], '')
  const standalone = config.data ? findValue(config.data.sections, ['Server State', 'Standalone configuration']) === 'Yes' : false
  const join = joinDomain ?? !standalone
  const nameProblem = name.trim() && !isDeviceName(name) ? 'Use letters, digits, hyphens and underscores, without spaces.' : null

  const approve = async () => {
    try {
      await answer.mutateAsync({
        requestId,
        approval: { name: name.trim() || null, bootImagePath: bootImage || null, wdsClientUnattend: unattend.trim() || null, joinDomain: join },
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
      <JoinDomainSwitch checked={join} onChange={setJoinDomain} standalone={standalone} />
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

/**
 * Deletes answered requests. WDS keeps them for the retention period and acts on them meanwhile: a rejected
 * device is turned away, and one approved and since removed isn't answered at all.
 */
export function ClearRequestsButton({ requests }: { requests: WdsRecord[] }) {
  const clear = useClearDeviceRequests()
  const [opened, setOpened] = useState(false)
  const approved = requests.filter((request) => request.Status === 'Approved').length
  const rejected = requests.filter((request) => request.Status === 'Denied').length
  const [choice, setChoice] = useState({ approved: false, rejected: true })
  if (approved + rejected === 0) return null

  const open = () => {
    setChoice({ approved: false, rejected: rejected > 0 })
    setOpened(true)
  }
  const confirm = async () => {
    try {
      await clear.mutateAsync({ approved: choice.approved && approved > 0, rejected: choice.rejected && rejected > 0 })
      notifications.show({ color: 'green', message: 'Cleared the requests' })
      setOpened(false)
    } catch (error) {
      failed("Couldn't clear the requests", error)
    }
  }

  return (
    <>
      <Button variant="default" leftSection={<IconClearAll size={16} />} onClick={open}>
        Clear answered requests…
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Clear answered requests" centered>
        <Text size="sm">
          WDS keeps answered requests for the retention period set under Pending devices, and acts on them: it turns away
          rejected devices, and ignores devices that were approved and have since been removed. Clearing them lets those
          devices ask again.
        </Text>
        <Stack gap="xs" mt="md">
          <Checkbox
            label={`Rejected (${rejected})`}
            disabled={rejected === 0}
            checked={choice.rejected && rejected > 0}
            onChange={(e) => setChoice({ ...choice, rejected: e.currentTarget.checked })}
          />
          <Checkbox
            label={`Approved (${approved})`}
            description="The devices approved from them stay prestaged."
            disabled={approved === 0}
            checked={choice.approved && approved > 0}
            onChange={(e) => setChoice({ ...choice, approved: e.currentTarget.checked })}
          />
        </Stack>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setOpened(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={clear.isPending}
            disabled={!((choice.rejected && rejected > 0) || (choice.approved && approved > 0))}
            onClick={confirm}
          >
            Clear
          </Button>
        </Group>
      </Modal>
    </>
  )
}
