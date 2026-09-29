/** A failed API call. The message is the server's problem detail, which is written to be shown as-is. */
export class ApiError extends Error {
  readonly status: number
  /** The whole problem-details body, for extra fields such as an upload's `received`. */
  readonly problem: Record<string, unknown>

  constructor(message: string, status: number, problem: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

/** Sends JSON (or nothing) and returns the parsed response, or undefined for 204 No Content. */
export async function apiSend<T = void>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    signal,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw await toApiError(response)
  return (response.status === 204 ? undefined : await response.json()) as T
}

/** PUTs raw bytes, for upload chunks. */
export async function apiPutBytes<T>(path: string, bytes: Blob, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'PUT',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream' },
    body: bytes,
  })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const problem = (await response.json()) as Record<string, unknown>
    const message = (problem.detail ?? problem.title ?? response.statusText) as string
    return new ApiError(message, response.status, problem)
  } catch {
    return new ApiError(`${response.status} ${response.statusText}`, response.status)
  }
}
