import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export const SHA256_PATTERN = /^[0-9a-f]{64}$/

export interface FileFingerprint {
  bytes: number
  sha256: string
}

/**
 * Node-only content fingerprint shared by desktop publishing and the web
 * server. File names and timestamps are useful hints, but only the bytes prove
 * that an immutable publication asset can be reused safely.
 */
export async function fingerprintFile(filePath: string, onProgress?: (bytesRead: number) => void): Promise<FileFingerprint> {
  const hash = createHash('sha256')
  let bytes = 0

  for await (const chunk of createReadStream(filePath)) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    hash.update(data)
    bytes += data.length
    onProgress?.(bytes)
  }

  return { bytes, sha256: hash.digest('hex') }
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}
