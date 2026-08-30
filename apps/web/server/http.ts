export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

export function jsonBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'The request is invalid.')
  return value as Record<string, unknown>
}
