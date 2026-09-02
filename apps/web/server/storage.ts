import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isSha256 } from '../../../src/node/fileFingerprint'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4'
}

export function storageNameForAsset(assetId: string, mimeType: string): string {
  const extension = MIME_EXTENSIONS[mimeType]
  if (!extension || !/^[0-9a-f-]{36}$/i.test(assetId)) throw new Error('The upload target is invalid.')
  return `${assetId}${extension}`
}

export function revisionDirectory(storageRoot: string, revisionId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(revisionId)) throw new Error('The revision identifier is invalid.')
  return resolve(storageRoot, revisionId)
}

export function storedAssetPath(storageRoot: string, revisionId: string, storageName: string): string {
  if (!/^[0-9a-f-]{36}\.(?:jpg|png|webp|svg|mp4)$/i.test(storageName)) {
    throw new Error('The stored asset name is invalid.')
  }
  return join(revisionDirectory(storageRoot, revisionId), storageName)
}

export class UploadIntegrityError extends Error {}

export interface StoredUpload {
  bytes: number
  sha256: string
}

export async function storeUpload(
  source: NodeJS.ReadableStream,
  destination: string,
  expectedBytes: number,
  expectedSha256?: string | null
): Promise<StoredUpload> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) throw new Error('The upload size is invalid.')
  if (expectedSha256 != null && !isSha256(expectedSha256)) throw new Error('The expected upload fingerprint is invalid.')
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.uploading`
  await rm(temporary, { force: true })
  try {
    const hash = createHash('sha256')
    const fingerprint = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        callback(null, chunk)
      }
    })
    await pipeline(source, fingerprint, createWriteStream(temporary, { flags: 'wx', mode: 0o640 }))
    const result = await stat(temporary)
    if (result.size !== expectedBytes) throw new UploadIntegrityError('The uploaded file size does not match the publication.')
    const sha256 = hash.digest('hex')
    if (expectedSha256 && sha256 !== expectedSha256) {
      throw new UploadIntegrityError('The uploaded file content changed while the publication was being prepared.')
    }
    await rename(temporary, destination)
    return { bytes: result.size, sha256 }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/**
 * Materializes a verified asset inside a new immutable revision without
 * sending it over the network again. A hard link keeps deletion of either
 * revision safe while consuming no duplicate disk space.
 */
export async function reuseStoredAsset(source: string, destination: string, expectedBytes: number): Promise<boolean> {
  const temporary = `${destination}.reusing`
  await mkdir(dirname(destination), { recursive: true })
  await rm(temporary, { force: true })
  try {
    const sourceStats = await stat(source)
    if (!sourceStats.isFile() || sourceStats.size !== expectedBytes) return false
    await link(source, temporary)
    await rename(temporary, destination)
    return true
  } catch (error) {
    await rm(temporary, { force: true })
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function removeRevisionStorage(storageRoot: string, revisionId: string): Promise<void> {
  await rm(revisionDirectory(storageRoot, revisionId), { recursive: true, force: true })
}

export function openStoredAsset(filePath: string, start?: number, end?: number) {
  return createReadStream(filePath, start === undefined ? undefined : { start, end })
}
