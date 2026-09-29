/** A failed API call. The message is the server's problem detail, which is written to be shown as-is. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const problem = (await response.json()) as { title?: string; detail?: string }
    return new ApiError(problem.detail ?? problem.title ?? response.statusText, response.status)
  } catch {
    return new ApiError(`${response.status} ${response.statusText}`, response.status)
  }
}
