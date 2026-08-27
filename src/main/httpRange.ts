export interface ByteRange {
  start: number
  end: number
  length: number
}

/**
 * Resolve one HTTP byte range. Undefined means no range was requested; null
 * means the request is unsatisfiable. Multiple ranges are intentionally not
 * supported because Cueport serves one local media file per request.
 */
export function resolveByteRange(header: string | null, totalBytes: number): ByteRange | null | undefined {
  if (!header) return undefined
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2])) return null

  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, totalBytes - suffixLength)
    end = totalBytes - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : totalBytes - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= totalBytes) {
      return null
    }
    end = Math.min(end, totalBytes - 1)
  }

  return { start, end, length: end - start + 1 }
}
