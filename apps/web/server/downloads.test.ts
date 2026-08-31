import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESENTATION_SETTINGS, PRESENTATION_DOCUMENT_VERSION, type PresentationDocument } from '../../../src/shared/presentation'
import type { AuthenticatedUser } from './database'
import { registerDownloadRoutes, sequenceArchiveDisposition, sequenceDownloadEntries } from './downloads'
import { revisionDirectory, storedAssetPath } from './storage'

const document: PresentationDocument = {
  schemaVersion: PRESENTATION_DOCUMENT_VERSION,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Köln / Launch',
  createdAt: '2026-08-31T00:00:00.000Z',
  updatedAt: '2026-08-31T00:00:00.000Z',
  activeSlideId: '22222222-2222-4222-8222-222222222222',
  settings: DEFAULT_PRESENTATION_SETTINGS,
  slides: [
    { id: '22222222-2222-4222-8222-222222222222', name: 'Homepage.png', width: 1920, height: 1080, assetKey: 'assets/home.jpg', mimeType: 'image/jpeg' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Animation.mp4', width: 1920, height: 1080, assetKey: 'assets/motion.mp4', mimeType: 'video/mp4', posterKey: 'thumbnails/motion.jpg' }
  ],
  references: [
    { id: '44444444-4444-4444-8444-444444444444', name: 'Reference.png', width: 800, height: 600, assetKey: 'references/reference.png', mimeType: 'image/png' }
  ],
  brand: null
}

describe('sequence presentation downloads', () => {
  it('includes ordered sequence originals but excludes references and video posters', () => {
    expect(sequenceDownloadEntries(document)).toEqual([
      { assetKey: 'assets/home.jpg', fileName: '01_Homepage.jpg', mimeType: 'image/jpeg' },
      { assetKey: 'assets/motion.mp4', fileName: '02_Animation.mp4', mimeType: 'video/mp4' }
    ])
  })

  it('creates safe ASCII and UTF-8 archive names', () => {
    expect(sequenceArchiveDisposition(document.name)).toBe(
      'attachment; filename="K-ln-Launch.zip"; filename*=UTF-8\'\'K%C3%B6ln%20-%20Launch.zip'
    )
    expect(sequenceArchiveDisposition('Version 1.0')).toContain('Version%201.0.zip')
  })

  it('streams one ZIP containing only the ordered Sequence media', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'cueport-download-test-'))
    const revisionId = '55555555-5555-4555-8555-555555555555'
    const imageStorageName = '66666666-6666-4666-8666-666666666666.jpg'
    const videoStorageName = '77777777-7777-4777-8777-777777777777.mp4'
    await mkdir(revisionDirectory(storageRoot, revisionId), { recursive: true })
    await writeFile(storedAssetPath(storageRoot, revisionId, imageStorageName), 'image bytes')
    await writeFile(storedAssetPath(storageRoot, revisionId, videoStorageName), 'video bytes')

    let requestedAssetKeys: string[] = []
    const pool = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.includes('cueport_presentations')) {
          return { rows: [{ revision_id: revisionId, document }] }
        }
        requestedAssetKeys = values?.[1] as string[] ?? []
        return {
          rows: [
            { asset_key: 'assets/home.jpg', mime_type: 'image/jpeg', storage_name: imageStorageName },
            { asset_key: 'assets/motion.mp4', mime_type: 'video/mp4', storage_name: videoStorageName }
          ]
        }
      }
    } as unknown as Pool
    const user: AuthenticatedUser = {
      id: '88888888-8888-4888-8888-888888888888',
      email: 'viewer@example.com',
      password_hash: 'unused',
      role: 'member',
      display_name: 'Viewer',
      title: '',
      avatar_mime_type: null,
      avatar_updated_at: null,
      is_protected: false
    }
    const app = Fastify()
    registerDownloadRoutes({ app, pool, storageRoot, requireUser: async () => user })

    try {
      const response = await app.inject({ method: 'GET', url: `/api/share/${'a'.repeat(32)}/download` })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('application/zip')
      expect(response.headers['content-disposition']).toBe(sequenceArchiveDisposition(document.name))
      expect(requestedAssetKeys).toEqual(['assets/home.jpg', 'assets/motion.mp4'])
      expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK')
      expect(response.rawPayload.includes(Buffer.from('01_Homepage.jpg'))).toBe(true)
      expect(response.rawPayload.includes(Buffer.from('02_Animation.mp4'))).toBe(true)
      expect(response.rawPayload.includes(Buffer.from('Reference'))).toBe(false)
    } finally {
      await app.close()
      await rm(storageRoot, { recursive: true, force: true })
    }
  })
})
