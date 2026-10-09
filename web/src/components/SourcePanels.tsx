import { Alert, Button, FileInput, Group, Progress, ScrollArea, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { IconAlertTriangle, IconFileUpload } from '@tabler/icons-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useServerConfig } from '../api/queries'
import type { ServerImageFile, UploadInfo } from '../api/types'
import { formatBytes, formatDateTime, formatDuration } from '../lib/format'
import { uploadFile, type UploadProgress } from '../lib/upload'

const GIB = 1024 ** 3

interface UploadPanelProps {
  /** Which files to offer, as for an input's accept attribute, e.g. ".iso,.wim,.esd". */
  accept: string
  label: string
  placeholder: string
  /** What the button that starts the upload says. */
  action: string
  onUploaded: (upload: UploadInfo) => void
  disabled: boolean
}

/** Uploads a file into the staging folder on the WDS server, resuming if it was partly sent before. */
export function UploadPanel({ accept, label, placeholder, action, onUploaded, disabled }: UploadPanelProps) {
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
        label={label}
        placeholder={placeholder}
        accept={accept}
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
            {action}
          </Button>
        )}
      </Group>
    </Stack>
  )
}

interface ServerFilePanelProps {
  /** Files found on the server to offer. */
  files: UseQueryResult<ServerImageFile[]>
  placeholder: string
  /** Says what was found, e.g. "3 .zip and .cab files found in …". */
  found: (count: number) => string
  /** What the button that takes the path says. */
  action: string
  onPick: (path: string) => void
  disabled: boolean
}

/** A path on the WDS server: typed, or picked from files found in its usual folders. */
export function ServerFilePanel({ files, placeholder, found, action, onPick, disabled }: ServerFilePanelProps) {
  const [path, setPath] = useState('')
  const needle = path.trim().toLowerCase()
  const matches = (files.data ?? []).filter((f) => !needle || f.path.toLowerCase().includes(needle)).slice(0, 100)

  return (
    <Stack>
      <TextInput
        label="Path on the WDS server"
        placeholder={placeholder}
        value={path}
        onChange={(event) => setPath(event.currentTarget.value)}
        disabled={disabled}
      />
      <Text size="xs" c="dimmed">
        {files.isPending
          ? 'Looking for files on the server…'
          : files.isError
            ? `Couldn't list files on the server: ${files.error.message}`
            : found(files.data?.length ?? 0)}
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
          {action}
        </Button>
      </Group>
    </Stack>
  )
}
