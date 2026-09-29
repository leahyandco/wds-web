import { Badge, Button, Card, Code, Drawer, Group, Loader, Stack, Text } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useJobs } from '../api/queries'
import type { ImageKind, ImportJob, JobStatus } from '../api/types'
import { formatAgo, formatDateTime, formatDuration } from '../lib/format'
import { useNow } from '../lib/useNow'

const statusBadges: Record<JobStatus, { label: string; color: string }> = {
  queued: { label: 'Queued', color: 'gray' },
  running: { label: 'Importing', color: 'blue' },
  succeeded: { label: 'Imported', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
}

/** Imports of one kind, newest first, refreshing the image list as each one finishes. */
export function ImportJobs({ kind }: { kind: ImageKind }) {
  const jobs = useJobs()
  const queryClient = useQueryClient()
  const now = useNow()
  const [openId, setOpenId] = useState<string | null>(null)
  const seenFinished = useRef(new Set<string>())

  const mine = (jobs.data ?? []).filter((job) => job.request.kind === kind)

  useEffect(() => {
    for (const job of mine) {
      if ((job.status === 'succeeded' || job.status === 'failed') && !seenFinished.current.has(job.id)) {
        seenFinished.current.add(job.id)
        void queryClient.invalidateQueries({ queryKey: [kind === 'boot' ? 'boot-images' : 'install-images'] })
        void queryClient.invalidateQueries({ queryKey: ['server-config'] })
      }
    }
  }, [mine, kind, queryClient])

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
  return (
    <Stack gap="sm">
      <Text size="sm">
        <b>Source:</b> {job.request.sourcePath}
        {job.request.innerPath ? ` → ${job.request.innerPath}` : ''} (image {job.request.index})
      </Text>
      {job.request.imageGroup && (
        <Text size="sm">
          <b>Image group:</b> {job.request.imageGroup}
        </Text>
      )}
      <Text size="sm">
        <b>File:</b> {job.request.fileName}
      </Text>
      <Code block>
        {job.log.length === 0
          ? 'Nothing logged yet.'
          : job.log.map((line) => `${formatDateTime(line.time)}  ${line.text}`).join('\n')}
      </Code>
    </Stack>
  )
}
