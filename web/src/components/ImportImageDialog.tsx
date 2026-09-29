import {
  Alert,
  Badge,
  Button,
  Checkbox,
  FileInput,
  Group,
  Loader,
  Modal,
  Progress,
  Radio,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Stepper,
  Text,
  TextInput,
  Textarea,
  UnstyledButton,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle, IconFileUpload } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { useInspectImage, useServerConfig, useServerImageFiles, useStartImport } from '../api/queries'
import type { ImageEntry, ImageFileEntry, ImageFileInfo, ImageKind, UploadInfo } from '../api/types'
import { formatBytes, formatDateTime, formatDuration, suggestFileName } from '../lib/format'
import { uploadFile, type UploadProgress } from '../lib/upload'
import { releaseTag, windowsRelease } from '../lib/windows'

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
        <UploadPanel onUploaded={(upload) => onChosen({ upload })} disabled={reading} />
      ) : (
        <ServerFilePanel onPick={(serverPath) => onChosen({ serverPath })} disabled={reading} />
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

function UploadPanel({ onUploaded, disabled }: { onUploaded: (upload: UploadInfo) => void; disabled: boolean }) {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const config = useServerConfig()

  // Closing the dialog stops the upload. What arrived so far stays on the server, and choosing the
  // same file again carries on from there.
  useEffect(() => () => controller.current?.abort(), [])

  const start = async () => {
    if (!file) return
    const abort = new AbortController()
    controller.current = abort
    setUploading(true)
    setError(null)
    setProgress({ sent: 0, total: file.size, bytesPerSecond: null, retrying: false })
    try {
      onUploaded(await uploadFile(file, setProgress, abort.signal))
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  const free = config.data?.remoteInstall?.freeBytes
  const tight = file != null && free != null && file.size > free - 2 * GIB
  const percent = progress ? (progress.sent / progress.total) * 100 : 0
  const secondsLeft = progress?.bytesPerSecond ? (progress.total - progress.sent) / progress.bytesPerSecond : null

  return (
    <Stack>
      <FileInput
        label="Image file"
        placeholder="Choose an .iso, .wim or .esd"
        accept=".iso,.wim,.esd"
        value={file}
        onChange={(chosen) => {
          setFile(chosen)
          setProgress(null)
          setError(null)
        }}
        disabled={uploading || disabled}
        leftSection={<IconFileUpload size={16} />}
        clearable
      />
      {file && (
        <Text size="xs" c="dimmed">
          {formatBytes(file.size)}
          {free != null && ` · ${formatBytes(free)} free on the WDS server`}
        </Text>
      )}
      {tight && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          The WDS server doesn't have room for this file: it needs {formatBytes(file!.size)} plus 2 GB to spare, and{' '}
          {formatBytes(free!)} is free.
        </Alert>
      )}
      {progress && (
        <div>
          <Progress value={percent} animated={uploading} />
          <Group justify="space-between" mt={4}>
            <Text size="xs" c="dimmed">
              {formatBytes(progress.sent)} of {formatBytes(progress.total)}
            </Text>
            <Text size="xs" c={progress.retrying ? 'yellow' : 'dimmed'}>
              {progress.retrying
                ? 'Connection lost, retrying…'
                : progress.bytesPerSecond && secondsLeft != null
                  ? `${formatBytes(progress.bytesPerSecond)}/s · ${formatDuration(secondsLeft)} left`
                  : ''}
            </Text>
          </Group>
        </div>
      )}
      {error && (
        <Alert color="red" icon={<IconAlertTriangle />}>
          {error}
        </Alert>
      )}
      <Group justify="flex-end">
        {uploading ? (
          <Button variant="default" onClick={() => controller.current?.abort()}>
            Stop upload
          </Button>
        ) : (
          <Button onClick={start} disabled={!file || tight || disabled}>
            Upload and read
          </Button>
        )}
      </Group>
    </Stack>
  )
}

function ServerFilePanel({ onPick, disabled }: { onPick: (path: string) => void; disabled: boolean }) {
  const files = useServerImageFiles(true)
  const [path, setPath] = useState('')
  const needle = path.trim().toLowerCase()
  const matches = (files.data ?? []).filter((f) => !needle || f.path.toLowerCase().includes(needle)).slice(0, 100)

  return (
    <Stack>
      <TextInput
        label="Path on the WDS server"
        placeholder="C:\ISO\Windows11.iso"
        value={path}
        onChange={(event) => setPath(event.currentTarget.value)}
        disabled={disabled}
      />
      <Text size="xs" c="dimmed">
        {files.isPending
          ? 'Looking for image files on the server…'
          : files.isError
            ? `Couldn't list image files: ${files.error.message}`
            : `${files.data?.length ?? 0} .iso, .wim and .esd files found in the server's Downloads and ISO folders. Pick one, or type any path.`}
      </Text>
      {matches.length > 0 && (
        <ScrollArea.Autosize mah={260} type="auto">
          <Stack gap={2}>
            {matches.map((file) => {
              const slash = file.path.lastIndexOf('\\')
              const chosen = file.path === path
              return (
                <UnstyledButton
                  key={file.path}
                  onClick={() => setPath(file.path)}
                  px="sm"
                  py={6}
                  style={{
                    borderRadius: 'var(--mantine-radius-sm)',
                    background: chosen ? 'var(--mantine-primary-color-light)' : undefined,
                  }}
                >
                  <Text size="sm" fw={500} style={{ wordBreak: 'break-all' }}>
                    {file.path.slice(slash + 1)}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                    {file.path.slice(0, slash)} · {formatBytes(file.size)} · {formatDateTime(file.modified)}
                  </Text>
                </UnstyledButton>
              )
            })}
          </Stack>
        </ScrollArea.Autosize>
      )}
      <Group justify="flex-end">
        <Button onClick={() => onPick(path.trim())} disabled={!path.trim() || disabled}>
          Read image
        </Button>
      </Group>
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
    <Stack mt="md">
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
        <Button
          onClick={submit}
          loading={start.isPending}
          disabled={!name.trim() || !fileName.trim() || (kind === 'install' && !imageGroup)}
        >
          Start import
        </Button>
      </Group>
    </Stack>
  )
}
