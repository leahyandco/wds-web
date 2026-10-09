import { Alert, Badge, Button, Card, Code, Drawer, Group, List, Loader, Stack, Text } from '@mantine/core'
import { IconAlertTriangle } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useJobs } from '../api/queries'
import type { BootImageDriversResult, DriverImportResult, ImportJob, ImportKind, JobStatus } from '../api/types'
import { formatAgo, formatDateTime, formatDuration } from '../lib/format'
import { useNow } from '../lib/useNow'

const statusBadges: Record<JobStatus, { label: string; color: string }> = {
  queued: { label: 'Queued', color: 'gray' },
  running: { label: 'Importing', color: 'blue' },
  succeeded: { label: 'Imported', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
}

/** What each kind of import changes, to refresh once one finishes. */
const refreshes: Record<ImportKind, string> = { boot: 'boot-images', install: 'install-images', drivers: 'drivers', 'boot-drivers': 'boot-images' }

/** Imports of the given kinds, newest first, refreshing what they change as each one finishes. */
export function ImportJobs({ kind }: { kind: ImportKind | ImportKind[] }) {
  const kinds: ImportKind[] = Array.isArray(kind) ? kind : [kind]
  const jobs = useJobs()
  const queryClient = useQueryClient()
  const now = useNow()
  const [openId, setOpenId] = useState<string | null>(null)
  const seenFinished = useRef(new Set<string>())

  const mine = (jobs.data ?? []).filter((job) => kinds.includes(job.request.kind))

  useEffect(() => {
    for (const job of mine) {
      if ((job.status === 'succeeded' || job.status === 'failed') && !seenFinished.current.has(job.id)) {
        seenFinished.current.add(job.id)
        void queryClient.invalidateQueries({ queryKey: [refreshes[job.request.kind]] })
        void queryClient.invalidateQueries({ queryKey: ['server-config'] })
      }
    }
  }, [mine, queryClient])

  // Recent ones only: running or queued, plus anything that finished in the last day.
  const visible = mine
    .filter((job) => job.status === 'queued' || job.status === 'running' || now - new Date(job.finishedAt ?? job.createdAt).getTime() < 86_400_000)
    .slice(0, 5)
  if (visible.length === 0) return null
  const open = mine.find((job) => job.id === openId) ?? null

  return (
    <Card withBorder mb="lg" padding="sm">
      <Text fw={600} size="sm" mb="xs">
        Imports
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
  const badge = statusBadges[job.status]
  const active = job.status === 'queued' || job.status === 'running'
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
            {job.percent != null && active ? ` (${job.percent}%)` : ''}
          </Text>
          <Text size="xs" c="dimmed">
            {active ? (took != null ? `Running for ${formatDuration(took)}` : 'Waiting to start') : `${formatAgo(job.finishedAt)}${took != null ? ` · took ${formatDuration(took)}` : ''}`}
          </Text>
        </div>
      </Group>
      <Button size="compact-xs" variant="subtle" onClick={onOpen}>
        Log
      </Button>
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
      <Code block>
        {job.log.length === 0
          ? 'Nothing logged yet.'
          : job.log.map((line) => `${formatDateTime(line.time)}  ${line.text}`).join('\n')}
      </Code>
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
