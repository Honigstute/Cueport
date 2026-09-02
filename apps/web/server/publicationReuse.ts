import { rm } from 'node:fs/promises'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { fingerprintFile, isSha256 } from '../../../src/node/fileFingerprint'
import { reuseStoredAsset, storedAssetPath } from './storage'

export interface FingerprintedPublicationAsset {
  key: string
  mimeType: string
  bytes: number
  sha256: string | null
}

export interface ReusablePublishedAsset {
  id: string
  revisionId: string
  storageName: string
}

interface StoredAssetRow extends QueryResultRow {
  id: string
  revision_id: string
  asset_key: string
  mime_type: string
  expected_bytes: string
  storage_name: string
  content_sha256: string | null
}

function fingerprintKey(asset: Pick<FingerprintedPublicationAsset, 'bytes' | 'mimeType' | 'sha256'>): string | null {
  return asset.sha256 ? `${asset.sha256}:${asset.bytes}:${asset.mimeType}` : null
}

/**
 * Existing installations have published assets from before fingerprints were
 * introduced. Hash only matching keys from the current live revision once so
 * the first incremental publish can already reuse unchanged media.
 */
export async function backfillCurrentRevisionFingerprints(
  pool: Pool,
  storageRoot: string,
  presentationId: string,
  ownerId: string,
  assets: FingerprintedPublicationAsset[]
): Promise<void> {
  const byKey = new Map(assets.filter((asset) => asset.sha256).map((asset) => [asset.key, asset]))
  if (byKey.size === 0) return

  const result = await pool.query<StoredAssetRow>(
    `SELECT assets.id, assets.revision_id, assets.asset_key, assets.mime_type,
            assets.expected_bytes, assets.storage_name, assets.content_sha256
     FROM cueport_presentations presentations
     JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
     JOIN cueport_revision_assets assets ON assets.revision_id = revisions.id
     WHERE presentations.id = $1 AND presentations.owner_id = $2
       AND revisions.status = 'published'
       AND assets.asset_key = ANY($3::text[])
       AND assets.uploaded_at IS NOT NULL
       AND assets.stored_bytes = assets.expected_bytes
       AND assets.content_sha256 IS NULL`,
    [presentationId, ownerId, [...byKey.keys()]]
  )

  for (const stored of result.rows) {
    const requested = byKey.get(stored.asset_key)
    const expectedBytes = Number(stored.expected_bytes)
    if (!requested || requested.mimeType !== stored.mime_type || requested.bytes !== expectedBytes) continue
    let fingerprint: Awaited<ReturnType<typeof fingerprintFile>>
    try {
      fingerprint = await fingerprintFile(storedAssetPath(storageRoot, stored.revision_id, stored.storage_name))
    } catch {
      // A missing legacy object cannot be reused; the new revision will upload it.
      continue
    }
    if (fingerprint.bytes !== expectedBytes) continue
    await pool.query(
      'UPDATE cueport_revision_assets SET content_sha256 = $1 WHERE id = $2 AND content_sha256 IS NULL',
      [fingerprint.sha256, stored.id]
    )
  }
}

/** Finds only server-verified assets belonging to the same Cueport owner. */
export async function findReusablePublishedAssets(
  client: PoolClient,
  ownerId: string,
  assets: FingerprintedPublicationAsset[]
): Promise<Map<string, ReusablePublishedAsset>> {
  const fingerprints = [...new Set(assets.map((asset) => asset.sha256).filter(isSha256))]
  if (fingerprints.length === 0) return new Map()

  const result = await client.query<StoredAssetRow>(
    `SELECT DISTINCT ON (assets.content_sha256, assets.expected_bytes, assets.mime_type)
            assets.id, assets.revision_id, assets.asset_key, assets.mime_type,
            assets.expected_bytes, assets.storage_name, assets.content_sha256
     FROM cueport_revision_assets assets
     JOIN cueport_revisions revisions ON revisions.id = assets.revision_id
     JOIN cueport_presentations presentations ON presentations.id = revisions.presentation_id
     WHERE presentations.owner_id = $1
       AND revisions.status = 'published'
       AND assets.uploaded_at IS NOT NULL
       AND assets.stored_bytes = assets.expected_bytes
       AND assets.content_sha256 = ANY($2::text[])
     ORDER BY assets.content_sha256, assets.expected_bytes, assets.mime_type,
              revisions.published_at DESC NULLS LAST`,
    [ownerId, fingerprints]
  )

  const candidates = new Map<string, ReusablePublishedAsset>()
  for (const stored of result.rows) {
    const key = fingerprintKey({
      sha256: stored.content_sha256,
      bytes: Number(stored.expected_bytes),
      mimeType: stored.mime_type
    })
    if (!key) continue
    candidates.set(key, {
      id: stored.id,
      revisionId: stored.revision_id,
      storageName: stored.storage_name
    })
  }

  const byAssetKey = new Map<string, ReusablePublishedAsset>()
  for (const asset of assets) {
    const key = fingerprintKey(asset)
    const candidate = key ? candidates.get(key) : undefined
    if (candidate) byAssetKey.set(asset.key, candidate)
  }
  return byAssetKey
}

export async function materializeReusableAsset(options: {
  pool: Pool
  storageRoot: string
  revisionId: string
  assetId: string
  storageName: string
  expectedBytes: number
  source: ReusablePublishedAsset
}): Promise<boolean> {
  const sourcePath = storedAssetPath(options.storageRoot, options.source.revisionId, options.source.storageName)
  const destination = storedAssetPath(options.storageRoot, options.revisionId, options.storageName)
  if (!await reuseStoredAsset(sourcePath, destination, options.expectedBytes)) return false

  try {
    const updated = await options.pool.query(
      `UPDATE cueport_revision_assets
       SET stored_bytes = expected_bytes, uploaded_at = now()
       WHERE id = $1 AND revision_id = $2 AND uploaded_at IS NULL`,
      [options.assetId, options.revisionId]
    )
    if (!updated.rowCount) {
      await rm(destination, { force: true })
      return false
    }
    return true
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
}
