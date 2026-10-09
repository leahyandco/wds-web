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
import { DialogForm } from './DialogForm'

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
  const label = requestLabel(request)

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
          <Modal
            opened={dialog === 'approve'}
            onClose={() => setDialog(null)}
            title={`Approve ${label}`}
            centered
            size="lg"
            closeOnClickOutside={false}
          >
            {dialog === 'approve' && <ApproveForm requestIds={[requestId]} label={label} onDone={() => setDialog(null)} />}
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

/** Approves one request, which can be given a name, or several at once with the same settings. */
function ApproveForm({ requestIds, label, onDone }: { requestIds: number[]; label: string; onDone: () => void }) {
  const answer = useAnswerDeviceRequest()
  const one = requestIds.length === 1
  const [done, setDone] = useState<number | null>(null)
  const [failures, setFailures] = useState<string[]>([])
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
    const failed: string[] = []
    setFailures([])
    for (const [index, requestId] of requestIds.entries()) {
      setDone(index)
      try {
        await answer.mutateAsync({
          requestId,
          approval: {
            name: one ? name.trim() || null : null,
            bootImagePath: bootImage || null,
            wdsClientUnattend: unattend.trim() || null,
            joinDomain: join,
          },
        })
      } catch (error) {
        failed.push(`${one ? label : `Request ${requestId}`}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    setDone(null)
    const approved = requestIds.length - failed.length
    if (approved > 0) {
      notifications.show({
        color: 'green',
        message: one ? `Approved ${label}. It carries on booting at its next check.` : `Approved ${approved} devices. They carry on booting at their next check.`,
      })
    }
    if (failed.length === 0) onDone()
    else setFailures(failed)
  }

  return (
    <DialogForm onSubmit={() => void approve()} canSubmit={!nameProblem}>
      <Text size="sm" c="dimmed">
        {one
          ? 'The client is waiting at its PXE screen and carries on booting the next time it checks.'
          : `These ${requestIds.length} clients are waiting at their PXE screens and carry on booting the next time they check. WDS names each one.`}{' '}
        Anything left empty follows the server's settings.
      </Text>
      {one && (
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          error={nameProblem}
          description="Leave empty to let WDS name it."
          data-autofocus
        />
      )}
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
      {failures.length > 0 && (
        <Alert color="red" icon={<IconAlertTriangle />} title={one ? undefined : `${failures.length} couldn't be approved`}>
          {failures.map((failure) => (
            <Text key={failure} size="sm">
              {failure}
            </Text>
          ))}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          {failures.length > 0 ? 'Close' : 'Cancel'}
        </Button>
        <Button type="submit" loading={done !== null} disabled={!!nameProblem}>
          {done !== null && !one ? `Approving ${done + 1} of ${requestIds.length}` : one ? 'Approve' : `Approve ${requestIds.length}`}
        </Button>
      </Group>
    </DialogForm>
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

/** What a request is called: its name, or its device ID, as WDS reports an unnamed request's name as empty. */
const requestLabel = (request: WdsRecord) =>
  asString(request.DeviceName) || asString(request.DeviceID) || `request ${String(request.RequestId)}`

/** Approve or reject the requests chosen on the Devices page, all at once. */
export function RequestBulkActions({ requests, onDone }: { requests: WdsRecord[]; onDone: () => void }) {
  const answer = useAnswerDeviceRequest()
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const [rejecting, setRejecting] = useState<number | null>(null)
  const ids = requests.map((request) => asNumber(request.RequestId)).filter((id): id is number => id !== null)
  const one = ids.length === 1
  const label = one ? requestLabel(requests[0]) : `${ids.length} requests`

  const reject = async () => {
    const failed: string[] = []
    for (const [index, requestId] of ids.entries()) {
      setRejecting(index)
      try {
        await answer.mutateAsync({ requestId, approval: 'reject' })
      } catch (error) {
        failed.push(`Request ${requestId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    setRejecting(null)
    if (failed.length < ids.length) notifications.show({ color: 'green', message: one ? `Rejected ${label}` : `Rejected ${ids.length - failed.length} requests` })
    if (failed.length > 0) failed.forEach((message) => notifications.show({ color: 'red', title: "Couldn't reject a request", message }))
    setDialog(null)
    onDone()
  }

  return (
    <>
      <Button size="xs" onClick={() => setDialog('approve')} leftSection={<IconCheck size={14} />}>
        {one ? 'Approve…' : `Approve ${ids.length}…`}
      </Button>
      <Button size="xs" variant="light" color="red" onClick={() => setDialog('reject')} leftSection={<IconX size={14} />}>
        {one ? 'Reject…' : `Reject ${ids.length}…`}
      </Button>
      <Modal opened={dialog === 'approve'} onClose={() => setDialog(null)} title={`Approve ${label}`} centered size="lg" closeOnClickOutside={false}>
        {dialog === 'approve' && (
          <ApproveForm
            requestIds={ids}
            label={label}
            onDone={() => {
              setDialog(null)
              onDone()
            }}
          />
        )}
      </Modal>
      <Modal opened={dialog === 'reject'} onClose={() => setDialog(null)} title={`Reject ${label}?`} centered>
        <Text size="sm">
          {one ? 'WDS tells the waiting client no, and it stops' : 'WDS tells the waiting clients no, and they stop'} network
          booting. {one ? 'The request stays' : 'The requests stay'} on the list as rejected for the retention period set under
          Pending devices.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDialog(null)}>
            Cancel
          </Button>
          <Button color="red" loading={rejecting !== null} onClick={reject}>
            {rejecting !== null && !one ? `Rejecting ${rejecting + 1} of ${ids.length}` : one ? 'Reject' : `Reject ${ids.length}`}
          </Button>
        </Group>
      </Modal>
    </>
  )
}
