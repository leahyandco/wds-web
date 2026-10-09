import { ApiError, apiGet, apiPutBytes, apiSend } from '../api/client'
import type { UploadInfo } from '../api/types'

// Under the API server's default 30 MB request limit, and big enough to keep a LAN busy.
const CHUNK_BYTES = 8 * 1024 * 1024
const MAX_RETRIES = 8

export interface UploadProgress {
  sent: number
  total: number
  bytesPerSecond: number | null
  /** Set while waiting to retry after a failed chunk. */
  retrying: boolean
}

let running = 0

/** Whether a file is being uploaded right now, so closing its dialog or the page can ask first. */
export const uploadsInProgress = () => running > 0

/** Asks before something that would stop an upload in progress; true when there's none, or it may stop. */
export const mayStopUploads = () =>
  !uploadsInProgress() ||
  window.confirm("Stop the upload? What's arrived so far stays on the WDS server, and choosing the same file again carries on from there.")

const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault()

/** Counts an upload as running while `work` does, and warns before the page is left meanwhile. */
export async function whileUploading<T>(work: () => Promise<T>): Promise<T> {
  if (running++ === 0) window.addEventListener('beforeunload', warnBeforeLeaving)
  try {
    return await work()
  } finally {
    if (--running === 0) window.removeEventListener('beforeunload', warnBeforeLeaving)
  }
}

/**
 * Sends a file to the WDS server's staging folder in chunks. A failed chunk is retried with back-off
 * after asking the server how much it has, and an unfinished upload of the same file (same name and
 * size) is picked up where it stopped, so a dropped connection or a page reload doesn't start over.
 */
export async function uploadFile(file: File, onProgress: (progress: UploadProgress) => void, signal: AbortSignal): Promise<UploadInfo> {
  const unfinished = (await apiGet<UploadInfo[]>('/uploads', signal)).find(
    (u) => u.fileName === file.name && u.size === file.size && !u.complete,
  )
  let upload = unfinished ?? (await apiSend<UploadInfo>('POST', '/uploads', { fileName: file.name, size: file.size }, signal))

  const startedAt = performance.now()
  const startedFrom = upload.received
  let failures = 0

  while (!upload.complete) {
    const offset = upload.received
    try {
      upload = await apiPutBytes<UploadInfo>(`/uploads/${upload.id}?offset=${offset}`, file.slice(offset, offset + CHUNK_BYTES), signal)
      failures = 0
    } catch (error) {
      if (signal.aborted) throw error
      // The server has a different amount than we thought: carry on from what it has.
      if (error instanceof ApiError && error.status === 409 && typeof error.problem.received === 'number') {
        upload = { ...upload, received: error.problem.received }
        continue
      }
      // Anything else the server rejected won't get better by retrying.
      if (error instanceof ApiError && error.status < 500) throw error
      if (++failures > MAX_RETRIES) throw error
      onProgress({ sent: upload.received, total: upload.size, bytesPerSecond: null, retrying: true })
      await delay(Math.min(30_000, 1_000 * 2 ** failures), signal)
      upload = await apiGet<UploadInfo>(`/uploads/${upload.id}`, signal)
      continue
    }

    const seconds = (performance.now() - startedAt) / 1000
    onProgress({
      sent: upload.received,
      total: upload.size,
      bytesPerSecond: seconds > 0.5 ? (upload.received - startedFrom) / seconds : null,
      retrying: false,
    })
  }
  return upload
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}
