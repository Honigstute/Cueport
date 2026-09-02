export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers
    }
  })
  const body = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new ApiRequestError(response.status, body?.error || 'Cueport could not complete that request.')
  return body as T
}
