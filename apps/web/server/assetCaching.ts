import type { Stats } from 'node:fs'

const ACCESS_CACHE_SECONDS = 60 * 60

/**
 * Asset bytes are immutable, but the share link around them can be revoked or
 * changed from public to private. Keep the established one-hour access window
 * and revalidate with ETags afterwards instead of letting a shared cache bypass
 * Cueport's access check for the lifetime of the asset.
 */
export function publishedAssetCacheControl(isPublic: boolean): string {
  return `${isPublic ? 'public' : 'private'}, max-age=${ACCESS_CACHE_SECONDS}, must-revalidate`
}

/** Prefer the upload fingerprint; legacy assets fall back to file metadata. */
export function publishedAssetEtag(contentSha256: string | null, file: Stats): string {
  if (contentSha256) return `"sha256-${contentSha256}"`
  return `W/"${file.size.toString(16)}-${Math.trunc(file.mtimeMs).toString(16)}"`
}

function weakEtagValue(value: string): string {
  return value.trim().replace(/^W\//, '')
}

/** GET and HEAD requests use weak comparison for If-None-Match. */
export function ifNoneMatchMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false
  const candidates = Array.isArray(header) ? header : [header]
  const expected = weakEtagValue(etag)
  return candidates.some((value) => value
    .split(',')
    .some((candidate) => candidate.trim() === '*' || weakEtagValue(candidate) === expected))
}
