const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeCommentBody(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Write a comment first.')
  const body = value.replace(/\r\n?/g, '\n').trim()
  if (!body) throw new Error('Write a comment first.')
  if (body.length > 4000 || /\u0000/.test(body)) throw new Error('Keep the comment shorter than 4,001 characters.')
  return body
}

export function normalizeSlideId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error('The selected layout is invalid.')
  return value.toLowerCase()
}

/** Persist normalized positions as integer parts-per-million for stable round trips. */
export function coordinateToPpm(value: unknown): number {
  const coordinate = Number(value)
  if (!Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1) {
    throw new Error('Place the discussion inside the layout.')
  }
  return Math.round(coordinate * 1_000_000)
}

export function ppmToCoordinate(value: number): number {
  return Math.max(0, Math.min(1, value / 1_000_000))
}
