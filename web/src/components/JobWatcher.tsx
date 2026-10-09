import { Anchor, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { useJobs } from '../api/queries'
import type { JobStatus } from '../api/types'
import { jobHeadline, jobPages, jobRefreshes } from '../lib/jobs'

/**
 * Follows the import and driver jobs from any page: when one finishes it refreshes what the job changed and
 * says so, with a link to the page that lists it. Imports take minutes, and people move on meanwhile.
 * Jobs that had finished before the page opened stay quiet.
 */
export function JobWatcher() {
  const jobs = useJobs()
  const queryClient = useQueryClient()
  const seen = useRef<Map<string, JobStatus> | null>(null)

  useEffect(() => {
    if (!jobs.data) return
    const before = seen.current
    seen.current = new Map(jobs.data.map((job) => [job.id, job.status]))
    if (before === null) return

    for (const job of jobs.data) {
      if ((job.status !== 'succeeded' && job.status !== 'failed') || before.get(job.id) === job.status) continue
      void queryClient.invalidateQueries({ queryKey: [jobRefreshes[job.request.kind]] })
      void queryClient.invalidateQueries({ queryKey: ['server-config'] })
      const page = jobPages[job.request.kind]
      const failed = job.status === 'failed'
      notifications.show({
        color: failed ? 'red' : 'green',
        title: jobHeadline(job),
        // A failure stays until it's read; a success goes by itself.
        autoClose: failed ? false : 8000,
        message: (
          <>
            {(failed ? job.error : job.stage) && (
              <Text size="sm" lineClamp={3}>
                {failed ? job.error : job.stage}
              </Text>
            )}
            <Anchor component={Link} to={page.path} size="sm">
              {failed ? 'See the log' : `Open ${page.label}`}
            </Anchor>
          </>
        ),
      })
    }
  }, [jobs.data, queryClient])

  return null
}
