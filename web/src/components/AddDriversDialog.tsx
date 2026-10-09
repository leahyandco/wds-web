import { Alert, Button, Card, Checkbox, Group, Modal, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconFileZip, IconFolder } from '@tabler/icons-react'
import { useState } from 'react'
import { useImportDrivers, useServerDriverFiles } from '../api/queries'
import type { UploadInfo } from '../api/types'
import { architectures } from '../lib/drivers'
import { formatBytes } from '../lib/format'
import { ServerFilePanel, UploadPanel } from './SourcePanels'
import { DialogForm } from './DialogForm'
import { mayStopUploads } from '../lib/upload'

const NO_GROUP = '\u0000none'
const NEW_GROUP = '\u0000new'
const ALL = '\u0000all'

type Source = { upload: UploadInfo } | { serverPath: string }

interface AddDriversDialogProps {
  opened: boolean
  onClose: () => void
  /** The existing driver groups, to add the drivers to one. */
  groups: string[]
  /** The group to offer first, such as the one being looked at. */
  initialGroup?: string | null
}

/**
 * Adds drivers to the WDS driver store: get them onto the server (upload a .zip or .cab, or point at
 * a file or folder already there), choose a driver group and architecture, and start. The import
 * runs on the server in the background; the page's job list follows it.
 */
export function AddDriversDialog({ opened, onClose, groups, initialGroup }: AddDriversDialogProps) {
  return (
    <Modal opened={opened} onClose={() => mayStopUploads() && onClose()} size="lg" closeOnClickOutside={false} title="Add drivers">
      {/* Mounted afresh on each opening, so nothing carries over from the last time. */}
      {opened && <AddDriversForm groups={groups} initialGroup={initialGroup ?? null} onDone={onClose} />}
    </Modal>
  )
}

function AddDriversForm({ groups, initialGroup, onDone }: { groups: string[]; initialGroup: string | null; onDone: () => void }) {
  const [mode, setMode] = useState<'upload' | 'server'>('upload')
  const [source, setSource] = useState<Source | null>(null)
  const files = useServerDriverFiles(mode === 'server' && source === null)
  const start = useImportDrivers()
  const [group, setGroup] = useState(initialGroup && groups.includes(initialGroup) ? initialGroup : NO_GROUP)
  const [newGroup, setNewGroup] = useState('')
  const [architecture, setArchitecture] = useState(ALL)
  const [deleteUpload, setDeleteUpload] = useState(true)

  const creating = group === NEW_GROUP
  const driverGroup = group === NO_GROUP ? null : creating ? newGroup.trim() : group
  const name = source ? ('upload' in source ? source.upload.fileName : source.serverPath) : ''

  const submit = async () => {
    if (!source) return
    try {
      await start.mutateAsync({
        ...('upload' in source ? { uploadId: source.upload.id, deleteUploadAfter: deleteUpload } : { serverPath: source.serverPath, deleteUploadAfter: false }),
        driverGroup,
        createGroup: creating,
        architecture: architecture === ALL ? null : architecture,
      })
      notifications.show({ title: 'Adding drivers', message: `Adding the drivers from ${name}. Their progress shows on this page.` })
      onDone()
    } catch {
      // Shown from start.error.
    }
  }

  if (!source) {
    return (
      <Stack>
        <Text size="sm" c="dimmed">
          Each .inf file in a .zip or .cab, a folder or on its own becomes a driver package; WDS skips any it already has. Drivers that
          come as an .exe need extracting first.
        </Text>
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as 'upload' | 'server')}
          data={[
            { value: 'upload', label: 'Upload from this computer' },
            { value: 'server', label: 'Already on the server' },
          ]}
        />
        {mode === 'upload' ? (
          <UploadPanel
            accept=".zip,.cab"
            label="Drivers"
            placeholder="Choose a .zip or .cab of drivers"
            action="Upload"
            onUploaded={(upload) => setSource({ upload })}
            disabled={false}
          />
        ) : (
          <ServerFilePanel
            files={files}
            placeholder="C:\Drivers\Latitude-5450"
            found={(count) =>
              `${count} .zip and .cab files found in the server's Downloads and Drivers folders. Pick one, or type the path of a folder, .zip, .cab or .inf.`
            }
            action="Use this"
            onPick={(serverPath) => setSource({ serverPath })}
            disabled={false}
          />
        )}
      </Stack>
    )
  }

  return (
    <DialogForm onSubmit={() => void submit()} canSubmit={!(creating && !newGroup.trim())}>
      <Card withBorder padding="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
            {/\.(zip|cab|inf)$/i.test(name) ? <IconFileZip size={20} /> : <IconFolder size={20} />}
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={500} style={{ wordBreak: 'break-all' }}>
                {name}
              </Text>
              <Text size="xs" c="dimmed">
                {'upload' in source ? `Uploaded, ${formatBytes(source.upload.size)}` : 'On the WDS server'}
              </Text>
            </div>
          </Group>
          <Button variant="subtle" size="compact-sm" onClick={() => setSource(null)} disabled={start.isPending}>
            Change
          </Button>
        </Group>
      </Card>
      <Select
        label="Driver group"
        description="A group decides which clients get its drivers. Packages in no group are in the store, but no client gets them."
        data={[{ value: NO_GROUP, label: 'No group' }, ...groups, { value: NEW_GROUP, label: 'New group…' }]}
        value={group}
        onChange={(value) => setGroup(value ?? NO_GROUP)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      {creating && (
        <TextInput
          label="New group name"
          description="It gives its drivers to every client, matching their hardware; add filters to it afterwards to narrow that down."
          value={newGroup}
          onChange={(event) => setNewGroup(event.currentTarget.value)}
          data-autofocus
          required
        />
      )}
      <Select
        label="Architecture"
        description="Add only the drivers for one architecture, skipping the rest."
        data={[{ value: ALL, label: 'All architectures' }, ...architectures]}
        value={architecture}
        onChange={(value) => setArchitecture(value ?? ALL)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      {'upload' in source && (
        <Checkbox
          label="Delete the uploaded file from the staging folder once the drivers are added"
          checked={deleteUpload}
          onChange={(event) => setDeleteUpload(event.currentTarget.checked)}
        />
      )}
      {start.error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {start.error.message}
        </Alert>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={start.isPending} disabled={creating && !newGroup.trim()}>
          Add drivers
        </Button>
      </Group>
    </DialogForm>
  )
}
