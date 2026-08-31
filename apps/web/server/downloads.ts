import { stat } from 'node:fs/promises'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ZipArchive } from 'archiver'
import type { Pool, QueryResultRow } from 'pg'
import { parsePresentationDocument, type PresentationDocument, type PresentationMediaMimeType } from '../../../src/shared/presentation'
import type { AuthenticatedUser } from './database'
import { ApiError } from './http'
import { hashToken } from './security'
import { storedAssetPath } from './storage'

interface DownloadRoutesOptions {
  app: FastifyInstance
  pool: Pool
  storageRoot: string
  requireUser: (request: FastifyRequest) => Promise<AuthenticatedUser>
}

interface PublishedRevisionRow extends QueryResultRow {
  revision_id: string
  document: unknown
}

interface StoredAssetRow extends QueryResultRow {
  asset_key: string
  mime_type: string
  storage_name: string
}

export interface SequenceDownloadEntry {
  assetKey: string
  fileName: string
  mimeType: PresentationMediaMimeType
}

function extensionForMimeType(mimeType: PresentationMediaMimeType): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'video/mp4': return 'mp4'
  }
}

function safeFileStem(value: string, fallback: string, stripExtension = true): string {
  const source = stripExtension ? value.replace(/\.[^./\\]+$/, '') : value
  const cleaned = source
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  return (cleaned || fallback).slice(0, 180)
}

/** Sequence-only by design: reference tray media and generated posters stay out. */
export function sequenceDownloadEntries(document: PresentationDocument): SequenceDownloadEntry[] {
  const digits = Math.max(2, String(document.slides.length).length)
  return document.slides.map((slide, index) => ({
    assetKey: slide.assetKey,
    fileName: `${String(index + 1).padStart(digits, '0')}_${safeFileStem(slide.name, `slide-${index + 1}`)}.${extensionForMimeType(slide.mimeType)}`,
    mimeType: slide.mimeType
  }))
}

function encodeHeaderFileName(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

export function sequenceArchiveDisposition(presentationName: string): string {
  const stem = safeFileStem(presentationName, 'Cueport-presentation', false)
  const unicodeName = `${stem}.zip`
  const asciiName = `${stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'Cueport-presentation'}.zip`
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeHeaderFileName(unicodeName)}`
}

export function registerDownloadRoutes({ app, pool, storageRoot, requireUser }: DownloadRoutesOptions): void {
  app.get('/api/share/:token/download', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (request, reply) => {
    await requireUser(request)
    const { token } = request.params as { token: string }
    if (token.length < 32 || token.length > 128) throw new ApiError(404, 'This presentation link is unavailable.')

    const revisionResult = await pool.query<PublishedRevisionRow>(
      `SELECT revisions.id AS revision_id, revisions.document
       FROM cueport_presentations presentations
       JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
       WHERE presentations.share_token_hash = $1 AND revisions.status = 'published'`,
      [hashToken(token)]
    )
    const published = revisionResult.rows[0]
    if (!published) throw new ApiError(404, 'This presentation link is unavailable.')

    const document = parsePresentationDocument(published.document)
    const entries = sequenceDownloadEntries(document)
    const assetsResult = await pool.query<StoredAssetRow>(
      `SELECT asset_key, mime_type, storage_name
       FROM cueport_revision_assets
       WHERE revision_id = $1 AND uploaded_at IS NOT NULL AND asset_key = ANY($2::text[])`,
      [published.revision_id, entries.map((entry) => entry.assetKey)]
    )
    const assetsByKey = new Map(assetsResult.rows.map((asset) => [asset.asset_key, asset]))
    const files = await Promise.all(entries.map(async (entry) => {
      const asset = assetsByKey.get(entry.assetKey)
      if (!asset || asset.mime_type !== entry.mimeType) {
        throw new ApiError(404, 'One of the presentation files is unavailable.')
      }
      const filePath = storedAssetPath(storageRoot, published.revision_id, asset.storage_name)
      const file = await stat(filePath)
      if (!file.isFile() || file.size < 1) throw new ApiError(404, 'One of the presentation files is unavailable.')
      return { fileName: entry.fileName, filePath }
    }))

    reply.header('Cache-Control', 'private, no-store')
    reply.header('Content-Disposition', sequenceArchiveDisposition(document.name))
    reply.type('application/zip')

    // Stored screenshots and videos are already compressed. ZIP store mode
    // packages them without expensive, ineffective recompression on the server.
    const archive = new ZipArchive({ store: true })
    archive.on('warning', (error) => request.log.warn(error))
    archive.on('error', (error) => request.log.error(error))
    for (const file of files) archive.file(file.filePath, { name: file.fileName })
    void archive.finalize().catch((error: unknown) => archive.destroy(
      error instanceof Error ? error : new Error('The presentation archive could not be created.')
    ))
    return reply.send(archive)
  })
}
