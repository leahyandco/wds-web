import type { ImportJob, ImportKind, JobStatus } from '../api/types'

/** What each kind of job changes, to refresh once one finishes. */
export const jobRefreshes: Record<ImportKind, string> = {
  boot: 'boot-images',
  install: 'install-images',
  drivers: 'drivers',
  'boot-drivers': 'boot-images',
}

/** The page that lists each kind of job. */
export const jobPages: Record<ImportKind, { path: string; label: string }> = {
  boot: { path: '/boot-images', label: 'Boot images' },
  install: { path: '/install-images', label: 'Install images' },
  drivers: { path: '/drivers', label: 'Drivers' },
  'boot-drivers': { path: '/drivers', label: 'Drivers' },
}

const working: Record<ImportKind, string> = {
  boot: 'Importing',
  install: 'Importing',
  drivers: 'Adding drivers',
  'boot-drivers': 'Adding drivers',
}

const done: Record<ImportKind, string> = { boot: 'Imported', install: 'Imported', drivers: 'Added', 'boot-drivers': 'Added' }

/** A job's state in words that fit what it does: importing an image, adding drivers. */
export function jobStatusLabel(job: ImportJob): { label: string; color: string } {
  const kind = job.request.kind
  const labels: Record<JobStatus, { label: string; color: string }> = {
    queued: { label: 'Queued', color: 'gray' },
    running: { label: working[kind], color: 'blue' },
    succeeded: { label: done[kind], color: 'green' },
    failed: { label: 'Failed', color: 'red' },
    cancelled: { label: 'Cancelled', color: 'gray' },
  }
  return labels[job.status]
}

/** What a finished job did, or failed to do, as a headline: "Imported Windows 11 Pro", "Couldn't add drivers to …". */
export function jobHeadline(job: ImportJob): string {
  const { kind, name } = job.request
  const ok = job.status === 'succeeded'
  if (kind === 'drivers') return ok ? `Added the drivers from ${name}` : `Couldn't add the drivers from ${name}`
  if (kind === 'boot-drivers') return ok ? `Added drivers to ${name}` : `Couldn't add drivers to ${name}`
  return ok ? `Imported ${name}` : `Couldn't import ${name}`
}

export const isActive = (job: ImportJob) => job.status === 'queued' || job.status === 'running'
