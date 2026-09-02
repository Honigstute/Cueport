import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { measureDirectoryUsage, readFileSystemUsage } from './storageUsage'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('server storage usage', () => {
  it('counts hard-linked publication assets only once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cueport-storage-'))
    temporaryDirectories.push(root)
    await mkdir(join(root, 'revision-a'))
    await mkdir(join(root, 'revision-b'))
    const original = join(root, 'revision-a', 'asset.jpg')
    await writeFile(original, Buffer.alloc(4_096, 7))
    await link(original, join(root, 'revision-b', 'asset.jpg'))

    const usage = await measureDirectoryUsage(root)

    expect(usage.contentBytes).toBe(4_096)
    expect(usage.physicalFileCount).toBe(1)
    expect(usage.allocatedBytes).toBeGreaterThanOrEqual(4_096)
  })

  it('returns internally consistent filesystem totals', async () => {
    const usage = await readFileSystemUsage(tmpdir())
    expect(usage.totalBytes).toBeGreaterThan(0)
    expect(usage.usedBytes).toBeGreaterThanOrEqual(0)
    expect(usage.availableBytes).toBeGreaterThanOrEqual(0)
    expect(usage.usedPercent).toBeGreaterThanOrEqual(0)
    expect(usage.usedPercent).toBeLessThanOrEqual(100)
  })
})
