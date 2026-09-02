import { opendir, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'

export interface FileSystemUsage {
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usedPercent: number
}

export interface DirectoryUsage {
  contentBytes: number
  allocatedBytes: number
  physicalFileCount: number
}

export interface ServerStorageUsage {
  fileSystem: FileSystemUsage
  media: DirectoryUsage
  measuredAt: string
}

function safeNumber(value: bigint, label: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label} exceeds Cueport's supported storage range.`)
  }
  return result
}

/**
 * Measures actual files rather than database rows. Reused publication assets
 * are hard links, so counting each device/inode pair once prevents unchanged
 * revisions from looking like duplicated disk usage.
 */
export async function measureDirectoryUsage(root: string): Promise<DirectoryUsage> {
  const seenFiles = new Set<string>()
  let contentBytes = 0n
  let allocatedBytes = 0n

  const visit = async (directory: string): Promise<void> => {
    const entries = await opendir(directory)
    for await (const entry of entries) {
      const filePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(filePath)
        continue
      }
      // The managed asset directory should not contain links or special files.
      // Ignoring them also prevents this diagnostic route from escaping root.
      if (!entry.isFile()) continue
      const details = await stat(filePath, { bigint: true })
      const identity = `${details.dev}:${details.ino}`
      if (seenFiles.has(identity)) continue
      seenFiles.add(identity)
      contentBytes += details.size
      allocatedBytes += details.blocks * 512n
    }
  }

  await visit(root)
  return {
    contentBytes: safeNumber(contentBytes, 'Cueport content size'),
    allocatedBytes: safeNumber(allocatedBytes, 'Cueport allocated size'),
    physicalFileCount: seenFiles.size
  }
}

export async function readFileSystemUsage(path: string): Promise<FileSystemUsage> {
  const details = await statfs(path, { bigint: true })
  const total = details.blocks * details.bsize
  const used = (details.blocks - details.bfree) * details.bsize
  const available = details.bavail * details.bsize
  const totalBytes = safeNumber(total, 'Server disk size')
  const usedBytes = safeNumber(used, 'Server used space')
  return {
    totalBytes,
    usedBytes,
    availableBytes: safeNumber(available, 'Server available space'),
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1_000) / 10 : 0
  }
}

/** Avoid walking every media file more than once during rapid dashboard refreshes. */
export function createStorageUsageReader(root: string, cacheMilliseconds = 30_000): () => Promise<ServerStorageUsage> {
  let cachedAt = 0
  let cached: Promise<ServerStorageUsage> | null = null

  return async () => {
    const now = Date.now()
    if (cached && now - cachedAt < cacheMilliseconds) return cached
    cachedAt = now
    cached = Promise.all([readFileSystemUsage(root), measureDirectoryUsage(root)])
      .then(([fileSystem, media]) => ({ fileSystem, media, measuredAt: new Date().toISOString() }))
      .catch((error) => {
        cached = null
        cachedAt = 0
        throw error
      })
    return cached
  }
}
