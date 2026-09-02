import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { fingerprintFile, isSha256 } from './fileFingerprint'

describe('file fingerprints', () => {
  it('hashes the actual bytes and reports streaming progress', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cueport-fingerprint-'))
    const filePath = join(directory, 'asset.bin')
    const content = Buffer.from('Cueport exact content')
    const progress: number[] = []
    await writeFile(filePath, content)

    try {
      await expect(fingerprintFile(filePath, (bytes) => progress.push(bytes))).resolves.toEqual({
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex')
      })
      expect(progress.at(-1)).toBe(content.length)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('accepts only canonical lowercase SHA-256 values', () => {
    expect(isSha256('a'.repeat(64))).toBe(true)
    expect(isSha256('A'.repeat(64))).toBe(false)
    expect(isSha256('a'.repeat(63))).toBe(false)
  })
})
