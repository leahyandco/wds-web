import { Alert, Badge, Button, Card, Drawer, Group, List, Loader, Progress, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useState } from 'react'
import { useCancelJob, useJobs, useRetryJob } from '../api/queries'
import type { BootImageDriversResult, DriverImportResult, ImportJob, ImportKind } from '../api/types'
import { formatAgo, formatDateTime, formatDuration } from '../lib/format'
import { isActive, jobStatusLabel } from '../lib/jobs'
import { useNow } from '../lib/useNow'
import { CopyCode } from './Copy'

/**
 * Jobs of the given kinds, newest first: queued ones can be cancelled, and failed or cancelled ones tried again.
 * The JobWatcher refreshes what a job changes once it finishes.
 */
export function ImportJobs({ kind }: { kind: ImportKind | ImportKind[] }) {
  const kinds: ImportKind[] = Array.isArray(kind) ? kind : [kind]
  const jobs = useJobs()
  const now = useNow()
  const [openId, setOpenId] = useState<string | null>(null)

  const mine = (jobs.data ?? []).filter((job) => kinds.includes(job.request.kind))

  // Recent ones only: running or queued, plus anything that finished in the last day.
  const visible = mine
    .filter((job) => isActive(job) || now - new Date(job.finishedAt ?? job.createdAt).getTime() < 86_400_000)
    .slice(0, 5)
  if (visible.length === 0) return null
  const open = mine.find((job) => job.id === openId) ?? null
  const imagesOnly = kinds.every((k) => k === 'boot' || k === 'install')

  return (
    <Card withBorder mb="lg" padding="sm">
      <Text fw={600} size="sm" mb="xs">
        {imagesOnly ? 'Imports' : 'Jobs'}
      </Text>
      <Stack gap="xs">
        {visible.map((job) => (
          <JobRow key={job.id} job={job} now={now} onOpen={() => setOpenId(job.id)} />
        ))}
      </Stack>
      <Drawer opened={open !== null} onClose={() => setOpenId(null)} position="right" size="lg" title={open?.request.name}>
        {open && <JobLog job={open} />}
      </Drawer>
    </Card>
  )
}

function JobRow({ job, now, onOpen }: { job: ImportJob; now: number; onOpen: () => void }) {
  const badge = jobStatusLabel(job)
  const active = isActive(job)
  const cancel = useCancelJob()
  const retry = useRetryJob()
  const failed = (title: string, error: unknown) =>
    notifications.show({ color: 'red', title, message: error instanceof Error ? error.message : String(error) })
  const took = job.startedAt
    ? ((job.finishedAt ? new Date(job.finishedAt).getTime() : now) - new Date(job.startedAt).getTime()) / 1000
    : null

  return (
    <Group justify="space-between" wrap="nowrap" align="flex-start">
      <Group gap="sm" wrap="nowrap" align="flex-start" style={{ minWidth: 0 }}>
        {job.status === 'running' ? <Loader size={18} mt={2} /> : null}
        <div style={{ minWidth: 0 }}>
          <Group gap="xs">
            <Text size="sm" fw={500}>
              {job.request.name}
            </Text>
            <Badge size="sm" variant="light" color={badge.color} tt="none">
              {badge.label}
            </Badge>
          </Group>
          <Text size="xs" c={job.status === 'failed' ? 'red' : 'dimmed'} lineClamp={2}>
            {job.status === 'failed' ? job.error : job.stage}
          </Text>
          {job.percent != null && job.status === 'running' && (
            <Progress value={job.percent} size="sm" mt={4} mb={2} w={260} maw="100%" aria-label={`${job.percent}% done`} />
          )}
          <Text size="xs" c="dimmed">
            {active ? (took != null ? `Running for ${formatDuration(took)}` : 'Waiting to start') : `${formatAgo(job.finishedAt)}${took != null ? ` · took ${formatDuration(took)}` : ''}`}
          </Text>
        </div>
      </Group>
      <Group gap={4} wrap="nowrap">
        {job.status === 'queued' && (
          <Button
            size="compact-xs"
            variant="subtle"
            color="red"
            loading={cancel.isPending}
            onClick={() => cancel.mutateAsync(job.id).catch((error) => failed(`Couldn't cancel ${job.request.name}`, error))}
          >
            Cancel
          </Button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <Button
            size="compact-xs"
            variant="subtle"
            loading={retry.isPending}
            onClick={() => retry.mutateAsync(job.id).catch((error) => failed(`Couldn't try ${job.request.name} again`, error))}
          >
            Try again
          </Button>
        )}
        <Button size="compact-xs" variant="subtle" onClick={onOpen}>
          Log
        </Button>
      </Group>
    </Group>
  )
}

function JobLog({ job }: { job: ImportJob }) {
  const request = job.request
  return (
    <Stack gap="sm">
      {request.kind === 'boot-drivers' ? (
        <>
          <Text size="sm">
            <b>Boot image:</b> {request.imageName} ({request.architecture})
          </Text>
          <Text size="sm">
            <b>Driver packages:</b> {request.packageIds.length}
          </Text>
          {job.status === 'succeeded' && <BootDriversResult result={job.result as BootImageDriversResult} />}
        </>
      ) : request.kind === 'drivers' ? (
        <>
          <Text size="sm">
            <b>Source:</b> {request.sourcePath}
          </Text>
          <Text size="sm">
            <b>Driver group:</b> {request.driverGroup ?? 'None'}
          </Text>
          <Text size="sm">
            <b>Architecture:</b> {request.architecture ?? 'All'}
          </Text>
          {job.status === 'succeeded' && <DriverResult result={job.result as DriverImportResult} />}
        </>
      ) : (
        <>
          <Text size="sm">
            <b>Source:</b> {request.sourcePath}
            {request.innerPath ? ` → ${request.innerPath}` : ''} (image {request.index})
          </Text>
          {request.imageGroup && (
            <Text size="sm">
              <b>Image group:</b> {request.imageGroup}
            </Text>
          )}
          <Text size="sm">
            <b>File:</b> {request.fileName}
          </Text>
        </>
      )}
      <CopyCode
        value={job.log.length === 0 ? 'Nothing logged yet.' : job.log.map((line) => `${formatDateTime(line.time)}  ${line.text}`).join('\n')}
        label="Copy the log"
      />
    </Stack>
  )
}

/** What a driver import added, and the .inf files it couldn't add or skipped. */
function DriverResult({ result }: { result: DriverImportResult }) {
  return (
    <>
      <Text size="sm">
        <b>Result:</b> {result.summary}.
      </Text>
      {result.failed.length > 0 && (
        <Alert color="orange" icon={<IconAlertTriangle />} title={`${result.failed.length} couldn't be added`}>
          <List size="sm" spacing={4}>
            {result.failed.map((f) => (
              <List.Item key={f.inf}>
                <b>{f.inf}</b>: {f.reason}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
      {result.otherArchitecture.length > 0 && (
        <Text size="sm" c="dimmed">
          Skipped for having no drivers for this architecture: {result.otherArchitecture.join(', ')}
        </Text>
      )}
    </>
  )
}

/** Which driver packages went into the boot image, and which WDS refused. */
function BootDriversResult({ result }: { result: BootImageDriversResult }) {
  return (
    <>
      <Text size="sm">
        <b>Result:</b> {result.summary}.
      </Text>
      {result.failed.length > 0 && (
        <Alert color="orange" icon={<IconAlertTriangle />} title={`${result.failed.length} couldn't be added`}>
          <List size="sm" spacing={4}>
            {result.failed.map((f) => (
              <List.Item key={f.id}>
                <b>{f.id}</b>: {f.reason}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
    </>
  )
}
