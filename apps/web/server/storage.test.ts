import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  reuseStoredAsset,
  storageNameForAsset,
  storedAssetPath,
  storeUpload,
  UploadIntegrityError
} from './storage'

const temporaryDirectories: string[] = []

async function temporaryStorage(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'cueport-storage-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('publication storage integrity', () => {
  it('verifies and returns the SHA-256 fingerprint while streaming an upload', async () => {
    const storageRoot = await temporaryStorage()
    const content = Buffer.from('verified Cueport asset')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const destination = storedAssetPath(storageRoot, randomUUID(), storageNameForAsset(randomUUID(), 'image/jpeg'))

    await expect(storeUpload(Readable.from(content), destination, content.length, sha256)).resolves.toEqual({
      bytes: content.length,
      sha256
    })
    await expect(readFile(destination)).resolves.toEqual(content)
  })

  it('rejects changed content before it becomes a stored revision asset', async () => {
    const storageRoot = await temporaryStorage()
    const content = Buffer.from('changed content')
    const destination = storedAssetPath(storageRoot, randomUUID(), storageNameForAsset(randomUUID(), 'image/jpeg'))

    await expect(storeUpload(Readable.from(content), destination, content.length, '0'.repeat(64)))
      .rejects.toBeInstanceOf(UploadIntegrityError)
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reuses a verified file in another immutable revision', async () => {
    const storageRoot = await temporaryStorage()
    const content = Buffer.from('shared immutable bytes')
    const source = storedAssetPath(storageRoot, randomUUID(), storageNameForAsset(randomUUID(), 'image/png'))
    const destination = storedAssetPath(storageRoot, randomUUID(), storageNameForAsset(randomUUID(), 'image/png'))
    await mkdir(dirname(source), { recursive: true })
    await writeFile(source, content)

    await expect(reuseStoredAsset(source, destination, content.length)).resolves.toBe(true)
    await expect(readFile(destination)).resolves.toEqual(content)
  })
})
