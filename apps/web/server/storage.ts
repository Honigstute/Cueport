import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

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

export async function storeUpload(
  source: NodeJS.ReadableStream,
  destination: string,
  expectedBytes: number
): Promise<number> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) throw new Error('The upload size is invalid.')
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.uploading`
  await rm(temporary, { force: true })
  try {
    await pipeline(source, createWriteStream(temporary, { flags: 'wx', mode: 0o640 }))
    const result = await stat(temporary)
    if (result.size !== expectedBytes) throw new Error('The uploaded file size does not match the publication.')
    await rename(temporary, destination)
    return result.size
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function removeRevisionStorage(storageRoot: string, revisionId: string): Promise<void> {
  await rm(revisionDirectory(storageRoot, revisionId), { recursive: true, force: true })
}

export function openStoredAsset(filePath: string, start?: number, end?: number) {
  return createReadStream(filePath, start === undefined ? undefined : { start, end })
}
