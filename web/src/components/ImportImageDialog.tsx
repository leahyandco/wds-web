import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Radio,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useState } from 'react'
import { useInspectImage, useServerConfig, useServerImageFiles, useStartImport } from '../api/queries'
import type { ImageEntry, ImageFileEntry, ImageFileInfo, ImageKind, UploadInfo } from '../api/types'
import { formatBytes, suggestFileName } from '../lib/format'
import { isBlockedSetup, releaseTag, windowsRelease } from '../lib/windows'
import { ServerFilePanel, UploadPanel } from './SourcePanels'
import { DialogForm } from './DialogForm'

const GIB = 1024 ** 3
const NEW_GROUP = '\u0000new'

type Source = { upload: UploadInfo } | { serverPath: string }

interface Selection {
  file: ImageFileEntry
  image: ImageEntry
}

interface ImportImageDialogProps {
  kind: ImageKind
  opened: boolean
  onClose: () => void
  /** Existing install image groups to import into. */
  groups?: string[]
}

/**
 * Walks through an import: get the file onto the WDS server (upload it, or pick one already there),
 * choose which image inside it, then name it and start the import. The import itself runs on the
 * server in the background; the page's job list follows it.
 */
export function ImportImageDialog({ kind, opened, onClose, groups = [] }: ImportImageDialogProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="xl"
      closeOnClickOutside={false}
      title={kind === 'boot' ? 'Import a boot image' : 'Import an install image'}
    >
      {/* Mounted afresh on each opening, so nothing carries over from the last import. */}
      {opened && <ImportWizard kind={kind} groups={groups} onDone={onClose} />}
    </Modal>
  )
}

function ImportWizard({ kind, groups, onDone }: { kind: ImageKind; groups: string[]; onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [source, setSource] = useState<Source | null>(null)
  const [info, setInfo] = useState<ImageFileInfo | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const inspect = useInspectImage()

  const read = async (chosen: Source) => {
    setSource(chosen)
    try {
      const result = await inspect.mutateAsync('upload' in chosen ? chosen.upload.serverPath : chosen.serverPath)
      setInfo(result)
      setSelection(defaultSelection(result, kind))
      setStep(1)
    } catch {
      // Shown from inspect.error.
    }
  }

  return (
    <Stepper active={step} onStepClick={(s) => s < step && setStep(s)} allowNextStepsSelect={false} size="sm" mt="xs">
      <Stepper.Step label="Source" description="Upload or pick a file">
        <SourceStep onChosen={read} reading={inspect.isPending} error={inspect.error?.message ?? null} />
      </Stepper.Step>
      <Stepper.Step label="Image" description="Choose what to import">
        {info && (
          <ChooseStep
            kind={kind}
            info={info}
            selection={selection}
            onSelect={setSelection}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
      </Stepper.Step>
      <Stepper.Step label="Details" description="Name and destination">
        {source && selection && (
          <DetailsStep kind={kind} source={source} selection={selection} groups={groups} onBack={() => setStep(1)} onDone={onDone} />
        )}
      </Stepper.Step>
    </Stepper>
  )
}

function defaultSelection(info: ImageFileInfo, kind: ImageKind): Selection | null {
  const file = info.files.find((f) => f.role === kind)
  if (!file || file.images.length === 0) return null
  // A boot.wim from Windows media holds WinPE (1) and Setup (2); Setup is the one marked bootable.
  const image = kind === 'boot' ? (file.images.find((i) => i.bootable) ?? file.images[file.images.length - 1]) : file.images[0]
  return { file, image }
}

function SourceStep({ onChosen, reading, error }: { onChosen: (source: Source) => void; reading: boolean; error: string | null }) {
  const [mode, setMode] = useState<'upload' | 'server'>('upload')
  const files = useServerImageFiles(mode === 'server')
  return (
    <Stack mt="md">
      <SegmentedControl
        value={mode}
        onChange={(value) => setMode(value as 'upload' | 'server')}
        data={[
          { value: 'upload', label: 'Upload from this computer' },
          { value: 'server', label: 'File already on the server' },
        ]}
        disabled={reading}
      />
      {mode === 'upload' ? (
        <UploadPanel
          accept=".iso,.wim,.esd"
          label="Image file"
          placeholder="Choose an .iso, .wim or .esd"
          action="Upload and read"
          onUploaded={(upload) => onChosen({ upload })}
          disabled={reading}
        />
      ) : (
        <ServerFilePanel
          files={files}
          placeholder="C:\ISO\Windows11.iso"
          found={(count) => `${count} .iso, .wim and .esd files found in the server's Downloads and ISO folders. Pick one, or type any path.`}
          action="Read image"
          onPick={(serverPath) => onChosen({ serverPath })}
          disabled={reading}
        />
      )}
      {reading && (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm">Reading the image. An ISO is mounted on the server for a few seconds while it's read.</Text>
        </Group>
      )}
      {error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {error}
        </Alert>
      )}
    </Stack>
  )
}

function ChooseStep({
  kind,
  info,
  selection,
  onSelect,
  onBack,
  onNext,
}: {
  kind: ImageKind
  info: ImageFileInfo
  selection: Selection | null
  onSelect: (selection: Selection) => void
  onBack: () => void
  onNext: () => void
}) {
  const candidates = info.files.filter((f) => f.role === kind)
  const others = info.files.filter((f) => f.role !== kind)

  return (
    <Stack mt="md">
      <Text size="sm" c="dimmed">
        {info.name} · {formatBytes(info.size)}
        {info.label ? ` · ${info.label}` : ''}
      </Text>
      {info.warning && (
        <Alert color="yellow" icon={<IconAlertTriangle />}>
          {info.warning}
        </Alert>
      )}
      {candidates.length === 0 ? (
        <Alert color="yellow" icon={<IconAlertTriangle />}>
          This file has no {kind} images.
          {others.length > 0 && ` It has ${kind === 'boot' ? 'install' : 'boot'} images; import it from the ${kind === 'boot' ? 'Install' : 'Boot'} images page instead.`}
        </Alert>
      ) : (
        <ScrollArea.Autosize mah={420} type="auto">
          <Stack>
            {candidates.map((file) => (
              <div key={file.innerPath ?? info.path}>
                {file.innerPath && (
                  <Text size="sm" fw={600} mb={6}>
                    {file.innerPath} · {formatBytes(file.size)}
                  </Text>
                )}
                <Radio.Group
                  value={selection?.file === file ? String(selection.image.index) : null}
                  onChange={(value) => onSelect({ file, image: file.images.find((i) => String(i.index) === value)! })}
                >
                  <Stack gap="xs">
                    {file.images.map((image) => (
                      <Radio.Card key={image.index} value={String(image.index)} p="sm" radius="md">
                        <Group wrap="nowrap" align="flex-start">
                          <Radio.Indicator mt={2} />
                          <div style={{ flex: 1 }}>
                            <Group gap="xs">
                              <Text size="sm" fw={500}>
                                {image.index}. {image.name}
                              </Text>
                              {kind === 'boot' && image.bootable && (
                                <Badge size="sm" variant="light" tt="none">
                                  Bootable
                                </Badge>
                              )}
                            </Group>
                            <Text size="xs" c="dimmed">
                              {[windowsRelease(image.version) ?? `Build ${image.version}`, image.version, image.architecture, image.editionId, formatBytes(image.size)]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                          </div>
                        </Group>
                      </Radio.Card>
                    ))}
                  </Stack>
                </Radio.Group>
              </div>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
      {kind === 'boot' && selection && isBlockedSetup(selection.image) && (
        <Alert color="orange" icon={<IconAlertTriangle />} title="Windows 11's own Setup won't run the WDS client">
          Clients can boot this image, but its Setup shows a deprecation notice where the WDS client should be, and the PC
          restarts. Every boot image from Windows 11 or Windows Server 2025 media does this. To install Windows over WDS,
          import the boot.wim from Windows 10 media (22H2) instead: its Setup runs the WDS client and installs Windows 11 too.
        </Alert>
      )}
      <Group justify="space-between">
        <Button variant="default" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!selection || !candidates.includes(selection.file)}>
          Next
        </Button>
      </Group>
    </Stack>
  )
}

/** "Windows 11 Pro" at build 26200 becomes "Windows 11 Pro 25H2"; other names are kept as they are. */
function defaultName(kind: ImageKind, image: ImageEntry): string {
  const tag = releaseTag(image.version)
  if (kind === 'install' && tag && /^Windows 1[01]\b/.test(image.name) && !image.name.includes(tag)) return `${image.name} ${tag}`
  return image.name
}

function DetailsStep({
  kind,
  source,
  selection,
  groups,
  onBack,
  onDone,
}: {
  kind: ImageKind
  source: Source
  selection: Selection
  groups: string[]
  onBack: () => void
  onDone: () => void
}) {
  const start = useStartImport()
  const config = useServerConfig()
  const initialName = defaultName(kind, selection.image)
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(selection.image.description ?? '')
  const [fileName, setFileName] = useState(suggestFileName(initialName))
  const [fileNameEdited, setFileNameEdited] = useState(false)
  const [group, setGroup] = useState<string | null>(groups[0] ?? NEW_GROUP)
  const [newGroup, setNewGroup] = useState('')
  const [deleteUpload, setDeleteUpload] = useState(true)

  const creatingGroup = kind === 'install' && group === NEW_GROUP
  const imageGroup = creatingGroup ? newGroup.trim() : (group ?? '')
  const free = config.data?.remoteInstall?.freeBytes
  // The compressed file is a fair upper bound for what the import adds to RemoteInstall.
  const tight = free != null && selection.file.size > free - 2 * GIB

  const ready = name.trim() !== '' && fileName.trim() !== '' && (kind !== 'install' || imageGroup !== '')

  const submit = async () => {
    try {
      await start.mutateAsync({
        ...('upload' in source ? { uploadId: source.upload.id, deleteUploadAfter: deleteUpload } : { serverPath: source.serverPath }),
        innerPath: selection.file.innerPath,
        kind,
        index: selection.image.index,
        imageGroup: kind === 'install' ? imageGroup : undefined,
        createGroup: creatingGroup,
        name: name.trim(),
        description: description.trim() || undefined,
        fileName: fileName.trim(),
      })
      notifications.show({ title: 'Import started', message: `${name.trim()} is importing. Its progress shows on this page.` })
      onDone()
    } catch {
      // Shown from start.error.
    }
  }

  return (
    <DialogForm mt="md" onSubmit={() => void submit()} canSubmit={ready}>
      <TextInput
        label="Name"
        description={kind === 'boot' ? 'Shown in the WDS boot menu' : 'Shown in the WDS client’s image list'}
        value={name}
        onChange={(event) => {
          const value = event.currentTarget.value
          setName(value)
          if (!fileNameEdited) setFileName(suggestFileName(value))
        }}
        required
      />
      <Textarea label="Description" autosize minRows={2} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
      <TextInput
        label="File name"
        description="The .wim file WDS keeps in RemoteInstall"
        value={fileName}
        onChange={(event) => {
          setFileName(event.currentTarget.value)
          setFileNameEdited(true)
        }}
        required
      />
      {kind === 'install' && (
        <>
          <Select
            label="Image group"
            data={[...groups, { value: NEW_GROUP, label: 'New group…' }]}
            value={group}
            onChange={setGroup}
            allowDeselect={false}
          />
          {creatingGroup && (
            <TextInput label="New group name" value={newGroup} onChange={(event) => setNewGroup(event.currentTarget.value)} required />
          )}
        </>
      )}
      {'upload' in source && (
        <Checkbox
          label="Delete the uploaded file from the staging folder once it's imported"
          checked={deleteUpload}
          onChange={(event) => setDeleteUpload(event.currentTarget.checked)}
        />
      )}
      {tight && (
        <Alert color="yellow" icon={<IconAlertTriangle />}>
          RemoteInstall has {formatBytes(free!)} free, and this image could need up to {formatBytes(selection.file.size)}. A new image group
          needs the most, since it can't share files with images in other groups.
        </Alert>
      )}
      {start.error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {start.error.message}
        </Alert>
      )}
      <Group justify="space-between">
        <Button variant="default" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={start.isPending} disabled={!ready}>
          Start import
        </Button>
      </Group>
    </DialogForm>
  )
}
