import { describe, expect, it } from 'vitest'
import type { Stats } from 'node:fs'
import {
  ifNoneMatchMatches,
  publishedAssetCacheControl,
  publishedAssetEtag
} from './assetCaching'

function fileStats(overrides: Partial<Stats> = {}): Stats {
  return {
    size: 4_096,
    mtimeMs: 1_725_000_000_000,
    ...overrides
  } as Stats
}

describe('published asset caching', () => {
  it('keeps public and private access revocable after the short browser cache window', () => {
    expect(publishedAssetCacheControl(true)).toBe('public, max-age=3600, must-revalidate')
    expect(publishedAssetCacheControl(false)).toBe('private, max-age=3600, must-revalidate')
  })

  it('creates a stable strong ETag from the stored content fingerprint', () => {
    expect(publishedAssetEtag('a'.repeat(64), fileStats())).toBe(`"sha256-${'a'.repeat(64)}"`)
  })

  it('creates a weak metadata ETag for legacy assets without a fingerprint', () => {
    expect(publishedAssetEtag(null, fileStats({ size: 255, mtimeMs: 4_095.9 }))).toBe('W/"ff-fff"')
  })

  it('matches wildcard, lists, and weak validators for conditional GET requests', () => {
    const etag = '"sha256-abc"'
    expect(ifNoneMatchMatches('*', etag)).toBe(true)
    expect(ifNoneMatchMatches('"other", W/"sha256-abc"', etag)).toBe(true)
    expect(ifNoneMatchMatches(['"other"', '"sha256-abc"'], etag)).toBe(true)
    expect(ifNoneMatchMatches('"other"', etag)).toBe(false)
    expect(ifNoneMatchMatches(undefined, etag)).toBe(false)
  })
})
