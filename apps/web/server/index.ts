import { randomUUID, timingSafeEqual } from 'node:crypto'
import { access, mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import type { QueryResultRow } from 'pg'
import { canEditPresentations } from '../../../src/shared/accounts'
import { parsePresentationDocument, type PresentationDocument } from '../../../src/shared/presentation'
import { createDatabase, runMigrations, type AuthenticatedUser, withTransaction } from './database'
import { PUBLICATION_PREVIEW_ASSET_KEY } from '../../../src/shared/projects'
import { isSha256 } from '../../../src/node/fileFingerprint'
import {
  collectExpectedAssets,
  normalizePresentationName,
  preferredDashboardThumbnailKeys
} from './presentationAssets'
import {
  createOpaqueToken,
  decryptToken,
  encryptToken,
  hashPassword,
  hashToken,
  normalizeEmail,
  verifyPassword
} from './security'
import {
  openStoredAsset,
  removeRevisionStorage,
  storageNameForAsset,
  storedAssetPath,
  storeUpload,
  UploadIntegrityError
} from './storage'
import { ApiError, jsonBody } from './http'
import { publicProfile, registerAccountRoutes } from './accounts'
import { requireAccountAdminRole, requireEditorRole, requirePresentationManager } from './authorization'
import { registerDiscussionRoutes } from './discussions'
import { registerDownloadRoutes } from './downloads'
import { requirePublishedPresentationAccess } from './presentationAccess'
import { registerPresentationSharingRoutes } from './presentationSharing'
import {
  backfillCurrentRevisionFingerprints,
  findReusablePublishedAssets,
  materializeReusableAsset,
  type FingerprintedPublicationAsset,
  type ReusablePublishedAsset
} from './publicationReuse'
import { createStorageUsageReader } from './storageUsage'

const MAX_ASSET_BYTES = 500 * 1024 * 1024
const MAX_PUBLICATION_BYTES = 2 * 1024 * 1024 * 1024
const SESSION_DAYS = 7
const DESKTOP_TOKEN_DAYS = 90
const SESSION_COOKIE = 'cueport_session'

interface ServerConfig {
  host: string
  port: number
  publicUrl: string
  databaseUrl: string
  storageRoot: string
  ownerEmail: string
  setupToken: string
  secret: string
  clientRoot: string
  production: boolean
}

interface DraftAssetInput {
  key: string
  mimeType: string
  bytes: number
  sha256?: string
}

interface DraftRequestBody {
  document: unknown
  assets: DraftAssetInput[]
  /** Web editors use this optimistic lock so an older browser tab cannot overwrite newer work. */
  baseRevisionId?: string
}

interface UserRow extends AuthenticatedUser {}

interface AssetRow extends QueryResultRow {
  id: string
  revision_id: string
  asset_key: string
  mime_type: string
  expected_bytes: string
  stored_bytes: string | null
  storage_name: string
  content_sha256: string | null
  status: string
  presentation_id: string
  owner_id: string
}

interface StorageTotalsRow extends QueryResultRow {
  presentation_count: number
  asset_count: number
  stale_draft_count: number
  stale_draft_bytes: string
}

async function removeRevisionDirectories(
  storageRoot: string,
  revisionIds: string[]
): Promise<Array<{ revisionId: string; error: unknown }>> {
  const results = await Promise.allSettled(
    revisionIds.map((revisionId) => removeRevisionStorage(storageRoot, revisionId))
  )
  return results.flatMap((result, index) => result.status === 'rejected'
    ? [{ revisionId: revisionIds[index], error: result.reason }]
    : [])
}

function readConfig(): ServerConfig {
  const required = (name: string): string => {
    const value = process.env[name]?.trim()
    if (!value) throw new Error(`${name} is required.`)
    return value
  }
  const publicUrl = required('CUEPORT_PUBLIC_URL').replace(/\/$/, '')
  const parsedPublicUrl = new URL(publicUrl)
  if (!['https:', 'http:'].includes(parsedPublicUrl.protocol)) throw new Error('CUEPORT_PUBLIC_URL must use HTTP or HTTPS.')

  return {
    host: process.env.CUEPORT_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.CUEPORT_PORT || 3002),
    publicUrl,
    databaseUrl: required('CUEPORT_DATABASE_URL'),
    storageRoot: resolve(required('CUEPORT_STORAGE_ROOT')),
    ownerEmail: normalizeEmail(required('CUEPORT_OWNER_EMAIL')),
    setupToken: required('CUEPORT_INITIAL_SETUP_TOKEN'),
    secret: required('CUEPORT_SECRET'),
    clientRoot: resolve(process.env.CUEPORT_CLIENT_ROOT || resolve(import.meta.dirname, '../dist-client')),
    production: process.env.NODE_ENV === 'production'
  }
}

function addDays(days: number): Date {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  return value
}

function readBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null
}

function tokensEqual(left: string, right: string): boolean {
  const leftHash = Buffer.from(hashToken(left), 'hex')
  const rightHash = Buffer.from(hashToken(right), 'hex')
  return leftHash.length === rightHash.length && timingSafeEqual(leftHash, rightHash)
}

function shareUrl(config: ServerConfig, tokenCipher: string | null): string | null {
  return tokenCipher ? `${config.publicUrl}/p/${decryptToken(tokenCipher, config.secret)}` : null
}

function loginEmail(value: unknown): string {
  try {
    return normalizeEmail(value)
  } catch {
    // Keep credential failures indistinguishable while still returning a
    // controlled client error instead of an internal-server response.
    throw new ApiError(401, 'The email address or password is incorrect.')
  }
}

async function requestedPasswordHash(value: unknown): Promise<string> {
  try {
    return await hashPassword(value)
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'Choose a valid password.')
  }
}

async function start(): Promise<void> {
  const config = readConfig()
  await mkdir(config.storageRoot, { recursive: true })
  const pool = createDatabase({ connectionString: config.databaseUrl, ownerEmail: config.ownerEmail })
  await runMigrations(pool, config.ownerEmail)
  const readStorageUsage = createStorageUsageReader(config.storageRoot)

  const app = Fastify({
    logger: { level: config.production ? 'info' : 'debug' },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: '127.0.0.1'
  })

  await app.register(cookie)
  await app.register(rateLimit, { global: false })

  // Asset uploads stay streamed to disk. Returning the parser stream avoids
  // holding large MP4 files in application memory.
  for (const contentType of ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'video/mp4']) {
    app.addContentTypeParser(contentType, (_request, payload, done) => done(null, payload))
  }

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
  })

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return
    if (
      readBearerToken(request) ||
      request.url === '/api/auth/login' ||
      request.url === '/api/auth/setup' ||
      request.url === '/api/auth/activate' ||
      request.url === '/api/desktop/login'
    ) return
    const origin = request.headers.origin
    if (!origin || origin !== config.publicUrl) throw new ApiError(403, 'The request origin is not allowed.')
  })

  app.setErrorHandler((error, request, reply) => {
    const candidate = error instanceof Error ? error : new Error('Unknown server error.')
    const status = candidate instanceof ApiError
      ? candidate.statusCode
      : Number('statusCode' in candidate ? candidate.statusCode : 0) || 500
    if (status >= 500) request.log.error(error)
    const message = status >= 500 ? 'Cueport could not complete that request.' : candidate.message
    void reply.code(status).send({ error: message })
  })

  async function userFromRequest(request: FastifyRequest): Promise<UserRow | null> {
    const bearer = readBearerToken(request)
    if (bearer) {
      const result = await pool.query<UserRow>(
        `UPDATE cueport_api_tokens tokens
         SET last_used_at = now()
         FROM cueport_users users
         WHERE tokens.token_hash = $1
           AND tokens.expires_at > now()
           AND users.id = tokens.user_id
           AND users.deleted_at IS NULL
         RETURNING users.id, users.email, users.password_hash, users.role,
                   users.display_name, users.title, users.avatar_mime_type,
                   users.avatar_updated_at, users.is_protected`,
        [hashToken(bearer)]
      )
      return result.rows[0] ?? null
    }

    const session = request.cookies[SESSION_COOKIE]
    if (!session) return null
    const result = await pool.query<UserRow>(
      `SELECT users.id, users.email, users.password_hash, users.role,
              users.display_name, users.title, users.avatar_mime_type,
              users.avatar_updated_at, users.is_protected
       FROM cueport_sessions sessions
       JOIN cueport_users users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > now()
         AND users.deleted_at IS NULL`,
      [hashToken(session)]
    )
    return result.rows[0] ?? null
  }

  async function requireUser(request: FastifyRequest): Promise<UserRow> {
    const user = await userFromRequest(request)
    if (!user) throw new ApiError(401, 'Sign in to continue.')
    return user
  }

  async function requireOwner(request: FastifyRequest): Promise<UserRow> {
    const user = await requireUser(request)
    if (user.role !== 'owner') throw new ApiError(403, 'Only the Cueport owner can do that.')
    return user
  }

  async function requireAccountAdmin(request: FastifyRequest): Promise<UserRow> {
    return requireAccountAdminRole(await requireUser(request))
  }

  async function requireEditor(request: FastifyRequest): Promise<UserRow> {
    return requireEditorRole(await requireUser(request))
  }

  async function createSession(userId: string, reply: FastifyReply): Promise<void> {
    const token = createOpaqueToken()
    const expires = addDays(SESSION_DAYS)
    await pool.query(
      'INSERT INTO cueport_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [hashToken(token), userId, expires]
    )
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      secure: config.production,
      sameSite: 'strict',
      expires
    })
  }

  app.get('/api/health', async () => {
    await pool.query('SELECT 1')
    return { status: 'ok' }
  })

  app.get('/api/session', async (request) => {
    const user = await userFromRequest(request)
    return user ? { authenticated: true, user: publicProfile(user) } : { authenticated: false }
  })

  app.get('/api/server/storage', async (request) => {
    const owner = await requireOwner(request)
    const [usage, totals] = await Promise.all([
      readStorageUsage(),
      pool.query<StorageTotalsRow>(
         `SELECT
           COUNT(DISTINCT presentations.id)::int AS presentation_count,
           COUNT(assets.id)::int AS asset_count,
           COUNT(DISTINCT revisions.id) FILTER (
             WHERE revisions.status = 'draft' AND revisions.created_at < now() - interval '24 hours'
           )::int AS stale_draft_count,
           COALESCE(SUM(assets.stored_bytes) FILTER (
             WHERE revisions.status = 'draft' AND revisions.created_at < now() - interval '24 hours'
           ), 0)::text AS stale_draft_bytes
         FROM cueport_presentations presentations
         LEFT JOIN cueport_revisions revisions ON revisions.presentation_id = presentations.id
         LEFT JOIN cueport_revision_assets assets
           ON assets.revision_id = revisions.id AND assets.uploaded_at IS NOT NULL
         WHERE presentations.owner_id = $1`,
        [owner.id]
      )
    ])
    const row = totals.rows[0]
    return {
      measuredAt: usage.measuredAt,
      server: usage.fileSystem,
      cueport: {
        contentBytes: usage.media.contentBytes,
        allocatedBytes: usage.media.allocatedBytes,
        physicalFileCount: usage.media.physicalFileCount,
        presentationCount: row?.presentation_count ?? 0,
        assetCount: row?.asset_count ?? 0,
        staleDraftCount: row?.stale_draft_count ?? 0,
        staleDraftBytes: Number(row?.stale_draft_bytes ?? 0)
      }
    }
  })

  app.post('/api/auth/setup', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = jsonBody(request.body)
    if (typeof body.token !== 'string' || !tokensEqual(body.token, config.setupToken)) {
      throw new ApiError(403, 'This setup link is invalid or has expired.')
    }
    const owner = await pool.query<UserRow>(
      `SELECT id, email, password_hash, role, display_name, title, avatar_mime_type,
              avatar_updated_at, is_protected
       FROM cueport_users WHERE email = $1 AND deleted_at IS NULL`,
      [config.ownerEmail]
    )
    const user = owner.rows[0]
    if (!user) throw new ApiError(500, 'The owner account is unavailable.')
    if (user.password_hash) throw new ApiError(409, 'The owner account has already been set up.')
    const passwordHash = await requestedPasswordHash(body.password)
    await pool.query('UPDATE cueport_users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, user.id])
    await createSession(user.id, reply)
    return { user: publicProfile({ ...user, password_hash: passwordHash }) }
  })

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const body = jsonBody(request.body)
    const email = loginEmail(body.email)
    const result = await pool.query<UserRow>(
      `SELECT id, email, password_hash, role, display_name, title, avatar_mime_type,
              avatar_updated_at, is_protected
       FROM cueport_users WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    )
    const user = result.rows[0]
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      throw new ApiError(401, 'The email address or password is incorrect.')
    }
    await createSession(user.id, reply)
    return { user: publicProfile(user) }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await pool.query('DELETE FROM cueport_sessions WHERE token_hash = $1', [hashToken(token)])
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { success: true }
  })

  app.post('/api/desktop/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request) => {
    const body = jsonBody(request.body)
    const email = loginEmail(body.email)
    const result = await pool.query<UserRow>(
      `SELECT id, email, password_hash, role, display_name, title, avatar_mime_type,
              avatar_updated_at, is_protected
       FROM cueport_users WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    )
    const user = result.rows[0]
    if (!user || !canEditPresentations(user.role) || !(await verifyPassword(body.password, user.password_hash))) {
      throw new ApiError(401, 'The email address or password is incorrect.')
    }
    const token = createOpaqueToken()
    const expires = addDays(DESKTOP_TOKEN_DAYS)
    await pool.query(
      `INSERT INTO cueport_api_tokens (token_hash, user_id, label, expires_at)
       VALUES ($1, $2, 'Cueport desktop', $3)`,
      [hashToken(token), user.id, expires]
    )
    return { token, email: user.email, expiresAt: expires.toISOString() }
  })

  registerAccountRoutes({
    app,
    pool,
    publicUrl: config.publicUrl,
    requireUser,
    requireAccountAdmin,
    createSession
  })
  registerDiscussionRoutes({ app, pool, requireUser })
  registerDownloadRoutes({ app, pool, storageRoot: config.storageRoot, userFromRequest })
  registerPresentationSharingRoutes({ app, pool, requireEditor })

  app.post('/api/publications/drafts', async (request) => {
    const editor = await requireEditor(request)
    const body = request.body as DraftRequestBody
    const document = parsePresentationDocument(body?.document)
    if (body?.baseRevisionId != null && (
      typeof body.baseRevisionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.baseRevisionId)
    )) {
      throw new ApiError(400, 'The editor version is invalid. Reload the presentation and try again.')
    }
    const existingManagement = await requirePresentationManager(pool, document.id, editor, { allowMissing: true })
    const presentationOwnerId = existingManagement?.ownerId ?? editor.id
    if (document.brand?.mimeType === 'image/svg+xml') {
      throw new ApiError(400, 'Use a PNG, JPEG, or WebP client mark for web publishing. SVG remains available in the desktop app.')
    }
    if (!Array.isArray(body?.assets)) throw new ApiError(400, 'The publication has no asset list.')
    const includePreview = body.assets.some((asset) => asset?.key === PUBLICATION_PREVIEW_ASSET_KEY)
    const expected = collectExpectedAssets(document, includePreview)
    const provided = new Map<string, FingerprintedPublicationAsset>()
    let totalBytes = 0
    for (const asset of body.assets) {
      const bytes = Number(asset?.bytes)
      if (!asset || typeof asset.key !== 'string' || typeof asset.mimeType !== 'string' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_ASSET_BYTES) {
        throw new ApiError(400, 'One of the publication assets is invalid or too large.')
      }
      if (asset.sha256 != null && !isSha256(asset.sha256)) {
        throw new ApiError(400, 'One of the publication asset fingerprints is invalid.')
      }
      if (provided.has(asset.key)) throw new ApiError(400, 'The publication repeats an asset.')
      provided.set(asset.key, {
        key: asset.key,
        mimeType: asset.mimeType,
        bytes,
        sha256: asset.sha256?.toLowerCase() ?? null
      })
      totalBytes += bytes
    }
    if (totalBytes > MAX_PUBLICATION_BYTES) throw new ApiError(413, 'The publication is too large.')
    if (expected.length !== provided.size || expected.some((asset) => provided.get(asset.key)?.mimeType !== asset.mimeType)) {
      throw new ApiError(400, 'The publication assets do not match its presentation document.')
    }

    // Older installations have no fingerprints on their already-published
    // files. Verify matching live assets from disk once before planning this
    // draft so the first incremental publish can already skip unchanged data.
    await backfillCurrentRevisionFingerprints(
      pool,
      config.storageRoot,
      document.id,
      presentationOwnerId,
      [...provided.values()]
    )

    const draft = await withTransaction(pool, async (client) => {
      const existing = await client.query<{ owner_id: string; published_revision_id: string | null }>(
        'SELECT owner_id, published_revision_id FROM cueport_presentations WHERE id = $1 FOR UPDATE',
        [document.id]
      )
      if (body.baseRevisionId && existing.rows[0]?.published_revision_id !== body.baseRevisionId) {
        throw new ApiError(409, 'This presentation changed in another session. Reload it before saving your changes.')
      }
      const lockedOwnerId = existing.rows[0]
        ? (await requirePresentationManager(client, document.id, editor))!.ownerId
        : editor.id
      await client.query(
        `INSERT INTO cueport_presentations (id, owner_id, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [document.id, lockedOwnerId, document.name]
      )
      // A presentation has exactly one live version and at most one in-flight
      // replacement. Starting again invalidates an abandoned upload draft.
      const discardedDrafts = await client.query<{ id: string }>(
        `DELETE FROM cueport_revisions
         WHERE presentation_id = $1 AND status = 'draft'
         RETURNING id`,
        [document.id]
      )
      const numberResult = await client.query<{ next: number }>(
        'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next FROM cueport_revisions WHERE presentation_id = $1',
        [document.id]
      )
      const revisionId = randomUUID()
      const revisionNumber = Number(numberResult.rows[0]?.next ?? 1)
      await client.query(
        `INSERT INTO cueport_revisions (id, presentation_id, revision_number, status, document)
         VALUES ($1, $2, $3, 'draft', $4::jsonb)`,
        [revisionId, document.id, revisionNumber, JSON.stringify(document)]
      )
      const reusable = await findReusablePublishedAssets(client, lockedOwnerId, [...provided.values()])
      const assets: Array<{
        id: string
        key: string
        bytes: number
        storageName: string
        reuseSource: ReusablePublishedAsset | null
      }> = []
      for (const asset of expected) {
        const input = provided.get(asset.key)!
        const id = randomUUID()
        const storageName = storageNameForAsset(id, asset.mimeType)
        await client.query(
          `INSERT INTO cueport_revision_assets
             (id, revision_id, asset_key, mime_type, expected_bytes, storage_name, content_sha256)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, revisionId, asset.key, asset.mimeType, input.bytes, storageName, input.sha256]
        )
        assets.push({
          id,
          key: asset.key,
          bytes: input.bytes,
          storageName,
          reuseSource: reusable.get(asset.key) ?? null
        })
      }
      return {
        revisionId,
        revisionNumber,
        assets,
        discardedDraftIds: discardedDrafts.rows.map((row) => row.id)
      }
    })

    const discardedDraftErrors = await removeRevisionDirectories(config.storageRoot, draft.discardedDraftIds)
    for (const failure of discardedDraftErrors) {
      request.log.warn(failure, 'An abandoned publication draft directory could not be removed.')
    }

    const reused = new Set<string>()
    for (const asset of draft.assets) {
      if (!asset.reuseSource) continue
      if (await materializeReusableAsset({
        pool,
        storageRoot: config.storageRoot,
        revisionId: draft.revisionId,
        assetId: asset.id,
        storageName: asset.storageName,
        expectedBytes: asset.bytes,
        source: asset.reuseSource
      })) reused.add(asset.key)
    }

    return {
      revisionId: draft.revisionId,
      revisionNumber: draft.revisionNumber,
      reused: [...reused],
      uploads: draft.assets.filter((asset) => !reused.has(asset.key)).map((asset) => ({
        key: asset.key,
        url: `/api/publications/revisions/${draft.revisionId}/assets/${asset.id}`
      }))
    }
  })

  app.put('/api/publications/revisions/:revisionId/assets/:assetId', { bodyLimit: MAX_ASSET_BYTES }, async (request) => {
    const editor = await requireEditor(request)
    const { revisionId, assetId } = request.params as { revisionId: string; assetId: string }
    const result = await pool.query<AssetRow>(
      `SELECT assets.*, revisions.status, revisions.presentation_id, presentations.owner_id
       FROM cueport_revision_assets assets
       JOIN cueport_revisions revisions ON revisions.id = assets.revision_id
       JOIN cueport_presentations presentations ON presentations.id = revisions.presentation_id
       WHERE assets.id = $1 AND revisions.id = $2`,
      [assetId, revisionId]
    )
    const asset = result.rows[0]
    if (!asset) throw new ApiError(404, 'The upload target does not exist.')
    await requirePresentationManager(pool, asset.presentation_id, editor)
    if (asset.status !== 'draft') throw new ApiError(409, 'This revision is already published.')
    if (request.headers['content-type']?.split(';')[0] !== asset.mime_type) throw new ApiError(415, 'The upload type does not match the publication.')
    const expectedBytes = Number(asset.expected_bytes)
    if (Number(request.headers['content-length']) !== expectedBytes) throw new ApiError(400, 'The upload size does not match the publication.')
    const destination = storedAssetPath(config.storageRoot, revisionId, asset.storage_name)
    let stored: Awaited<ReturnType<typeof storeUpload>>
    try {
      stored = await storeUpload(request.body as Readable, destination, expectedBytes, asset.content_sha256)
    } catch (error) {
      if (error instanceof UploadIntegrityError) throw new ApiError(400, error.message)
      throw error
    }
    await pool.query(
      'UPDATE cueport_revision_assets SET stored_bytes = $1, content_sha256 = $2, uploaded_at = now() WHERE id = $3',
      [stored.bytes, stored.sha256, asset.id]
    )
    return { success: true }
  })

  app.post('/api/publications/revisions/:revisionId/commit', async (request) => {
    const editor = await requireEditor(request)
    const { revisionId } = request.params as { revisionId: string }
    const result = await withTransaction(pool, async (client) => {
      const revision = await client.query<{
        presentation_id: string
        revision_number: number
        status: string
        owner_id: string
        share_token_cipher: string | null
      }>(
        `SELECT revisions.presentation_id, revisions.revision_number, revisions.status,
                presentations.owner_id, presentations.share_token_cipher
         FROM cueport_revisions revisions
         JOIN cueport_presentations presentations ON presentations.id = revisions.presentation_id
         WHERE revisions.id = $1 FOR UPDATE`,
        [revisionId]
      )
      const row = revision.rows[0]
      if (!row) throw new ApiError(404, 'The publication draft does not exist.')
      await requirePresentationManager(client, row.presentation_id, editor)
      if (row.status !== 'draft') throw new ApiError(409, 'This revision is already published.')
      const missing = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM cueport_revision_assets
         WHERE revision_id = $1
           AND (stored_bytes IS NULL OR stored_bytes <> expected_bytes OR content_sha256 IS NULL)`,
        [revisionId]
      )
      if (Number(missing.rows[0]?.count) > 0) throw new ApiError(409, 'Finish all asset uploads before publishing.')

      const token = row.share_token_cipher ? decryptToken(row.share_token_cipher, config.secret) : createOpaqueToken()
      const cipher = row.share_token_cipher ?? encryptToken(token, config.secret)
      // Remove the old database version first inside the same transaction.
      // Other readers continue to see it until commit, and a rollback restores
      // it. This ordering also enforces one published row per presentation.
      const obsolete = await client.query<{ id: string }>(
        `DELETE FROM cueport_revisions
         WHERE presentation_id = $1 AND id <> $2
         RETURNING id`,
        [row.presentation_id, revisionId]
      )
      await client.query(
        `UPDATE cueport_revisions SET status = 'published', published_at = now() WHERE id = $1`,
        [revisionId]
      )
      await client.query(
        `UPDATE cueport_presentations
         SET published_revision_id = $1, share_token_hash = $2, share_token_cipher = $3, updated_at = now()
         WHERE id = $4`,
        [revisionId, hashToken(token), cipher, row.presentation_id]
      )
      return {
        token,
        revisionNumber: row.revision_number,
        obsoleteRevisionIds: obsolete.rows.map((candidate) => candidate.id)
      }
    })
    const obsoleteErrors = await removeRevisionDirectories(config.storageRoot, result.obsoleteRevisionIds)
    for (const failure of obsoleteErrors) {
      request.log.warn(failure, 'An obsolete publication directory could not be removed.')
    }
    return { shareUrl: `${config.publicUrl}/p/${result.token}`, revisionNumber: result.revisionNumber }
  })

  app.get('/api/presentations', async (request) => {
    const user = await requireUser(request)
    const result = await pool.query<{
      id: string
      owner_id: string
      name: string
      updated_at: Date
      share_token_cipher: string | null
      is_public: boolean
      has_grant: boolean
      revision_number: number | null
      published_bytes: string
      document: PresentationDocument | null
    }>(
      `SELECT presentations.id, presentations.owner_id, presentations.name, presentations.updated_at,
              presentations.share_token_cipher, presentations.is_public,
              access.user_id IS NOT NULL AS has_grant,
              revisions.revision_number, revisions.document,
              (SELECT COALESCE(SUM(current_assets.stored_bytes), 0)::text
               FROM cueport_revision_assets current_assets
               WHERE current_assets.revision_id = presentations.published_revision_id
                 AND current_assets.uploaded_at IS NOT NULL) AS published_bytes
       FROM cueport_presentations presentations
       LEFT JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
       LEFT JOIN cueport_presentation_access access
         ON access.presentation_id = presentations.id AND access.user_id = $1
       WHERE $2::boolean
          OR presentations.owner_id = $1
          OR (access.user_id = $1 AND ($3::boolean OR presentations.share_token_hash IS NOT NULL))
       ORDER BY presentations.updated_at DESC`,
      [user.id, user.role === 'owner', canEditPresentations(user.role)]
    )
    return {
      presentations: result.rows.map((row) => {
        const document = row.document ? parsePresentationDocument(row.document) : null
        return {
          id: row.id,
          name: row.name,
          updatedAt: row.updated_at.toISOString(),
          slideCount: document?.slides.length ?? 0,
          canManage: canEditPresentations(user.role) && (
            user.role === 'owner' || row.owner_id === user.id || row.has_grant
          ),
          isPublic: row.is_public,
          publishedBytes: Number(row.published_bytes),
          shareUrl: shareUrl(config, row.share_token_cipher),
          thumbnailUrl: document && preferredDashboardThumbnailKeys(document).length > 0
            ? `/api/presentations/${row.id}/thumbnail?v=${row.revision_number ?? 0}`
            : null
        }
      })
    }
  })

  app.get('/api/presentations/:presentationId/thumbnail', async (request, reply) => {
    const user = await requireUser(request)
    const { presentationId } = request.params as { presentationId: string }
    const published = await pool.query<{ revision_id: string; document: unknown }>(
      `SELECT revisions.id AS revision_id, revisions.document
       FROM cueport_presentations presentations
       JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
       LEFT JOIN cueport_presentation_access access
         ON access.presentation_id = presentations.id AND access.user_id = $2
       WHERE presentations.id = $1
         AND (
           $3::boolean
           OR presentations.owner_id = $2
           OR (access.user_id = $2 AND ($4::boolean OR presentations.share_token_hash IS NOT NULL))
         )`,
      [presentationId, user.id, user.role === 'owner', canEditPresentations(user.role)]
    )
    const row = published.rows[0]
    if (!row) throw new ApiError(404, 'The presentation thumbnail is unavailable.')
    const preferredKeys = preferredDashboardThumbnailKeys(parsePresentationDocument(row.document))
    const assets = await pool.query<{
      asset_key: string
      mime_type: string
      storage_name: string
    }>(
      `SELECT asset_key, mime_type, storage_name
       FROM cueport_revision_assets
       WHERE revision_id = $1 AND asset_key = ANY($2::text[]) AND uploaded_at IS NOT NULL`,
      [row.revision_id, preferredKeys]
    )
    const byKey = new Map(assets.rows.map((asset) => [asset.asset_key, asset]))
    const asset = preferredKeys.map((key) => byKey.get(key)).find(Boolean)
    if (!asset || !asset.mime_type.startsWith('image/')) {
      throw new ApiError(404, 'The presentation thumbnail is unavailable.')
    }
    const filePath = storedAssetPath(config.storageRoot, row.revision_id, asset.storage_name)
    const file = await stat(filePath)
    reply.header('Cache-Control', 'private, no-store')
    reply.header('Content-Length', file.size)
    reply.type(asset.mime_type)
    return reply.send(openStoredAsset(filePath))
  })

  app.patch('/api/presentations/:presentationId', async (request) => {
    const editor = await requireEditor(request)
    const { presentationId } = request.params as { presentationId: string }
    await requirePresentationManager(pool, presentationId, editor)
    let name: string
    try {
      name = normalizePresentationName(jsonBody(request.body).name)
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'Enter a presentation name.')
    }
    const result = await pool.query(
      `UPDATE cueport_presentations SET name = $1, updated_at = now()
       WHERE id = $2`,
      [name, presentationId]
    )
    if (!result.rowCount) throw new ApiError(404, 'The presentation does not exist.')
    return { success: true, name }
  })

  app.post('/api/presentations/:presentationId/revoke', async (request) => {
    const editor = await requireEditor(request)
    const { presentationId } = request.params as { presentationId: string }
    await requirePresentationManager(pool, presentationId, editor)
    const result = await pool.query(
      `UPDATE cueport_presentations
       SET share_token_hash = NULL, share_token_cipher = NULL, updated_at = now()
       WHERE id = $1`,
      [presentationId]
    )
    if (!result.rowCount) throw new ApiError(404, 'The presentation does not exist.')
    return { success: true }
  })

  app.delete('/api/presentations/:presentationId', async (request) => {
    const editor = await requireEditor(request)
    const { presentationId } = request.params as { presentationId: string }
    await requirePresentationManager(pool, presentationId, editor)
    const revisions = await pool.query<{ id: string }>(
      `SELECT revisions.id FROM cueport_revisions revisions
       JOIN cueport_presentations presentations ON presentations.id = revisions.presentation_id
       WHERE presentations.id = $1`,
      [presentationId]
    )
    const result = await pool.query('DELETE FROM cueport_presentations WHERE id = $1', [presentationId])
    if (!result.rowCount) throw new ApiError(404, 'The presentation does not exist.')
    await Promise.all(revisions.rows.map((revision) => removeRevisionStorage(config.storageRoot, revision.id)))
    return { success: true }
  })

  app.get('/api/share/:token', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    const { token } = request.params as { token: string }
    const user = await userFromRequest(request)
    const published = await requirePublishedPresentationAccess(pool, token, user)
    const assets = await pool.query<{
      id: string
      asset_key: string
      mime_type: string
      expected_bytes: string
      stored_bytes: string | null
      content_sha256: string | null
    }>(
      `SELECT id, asset_key, mime_type, expected_bytes, stored_bytes, content_sha256
       FROM cueport_revision_assets
       WHERE revision_id = $1 AND uploaded_at IS NOT NULL`,
      [published.revisionId]
    )
    const assetUrls = Object.fromEntries(assets.rows.map((asset) => [
      asset.asset_key,
      `/api/share/${encodeURIComponent(token)}/assets/${asset.id}`
    ]))
    return {
      document: published.document,
      access: {
        isPublic: published.isPublic,
        authenticated: Boolean(user),
        canComment: Boolean(user),
        canEdit: published.canEdit
      },
      assets: assetUrls,
      editor: published.canEdit ? {
        presentationId: published.presentationId,
        revisionId: published.revisionId,
        assets: assets.rows.map((asset) => ({
          key: asset.asset_key,
          url: assetUrls[asset.asset_key],
          mimeType: asset.mime_type,
          bytes: Number(asset.stored_bytes ?? asset.expected_bytes),
          sha256: asset.content_sha256
        }))
      } : null
    }
  })

  app.get('/api/share/:token/assets/:assetId', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token, assetId } = request.params as { token: string; assetId: string }
    const user = await userFromRequest(request)
    const published = await requirePublishedPresentationAccess(pool, token, user)
    const result = await pool.query<{
      revision_id: string
      mime_type: string
      storage_name: string
    }>(
      `SELECT assets.revision_id, assets.mime_type, assets.storage_name
       FROM cueport_revision_assets assets
       WHERE assets.revision_id = $1 AND assets.id = $2 AND assets.uploaded_at IS NOT NULL`,
      [published.revisionId, assetId]
    )
    const asset = result.rows[0]
    if (!asset) throw new ApiError(404, 'The presentation asset is unavailable.')
    const filePath = storedAssetPath(config.storageRoot, asset.revision_id, asset.storage_name)
    const file = await stat(filePath)
    const range = request.headers.range
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Cache-Control', published.isPublic ? 'public, max-age=3600' : 'private, max-age=3600')
    reply.type(asset.mime_type)
    if (!range) {
      reply.header('Content-Length', file.size)
      return reply.send(openStoredAsset(filePath))
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) return reply.code(416).header('Content-Range', `bytes */${file.size}`).send()
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= file.size) {
      return reply.code(416).header('Content-Range', `bytes */${file.size}`).send()
    }
    reply.code(206)
    reply.header('Content-Length', end - start + 1)
    reply.header('Content-Range', `bytes ${start}-${end}/${file.size}`)
    return reply.send(openStoredAsset(filePath, start, end))
  })

  app.all('/api/*', async () => {
    throw new ApiError(404, 'This Cueport API route does not exist.')
  })

  await access(config.clientRoot)
  await app.register(fastifyStatic, { root: config.clientRoot, prefix: '/', wildcard: false })
  app.get('/*', async (_request, reply) => reply.sendFile('index.html'))

  const shutdown = async (): Promise<void> => {
    await app.close()
    await pool.end()
  }
  process.once('SIGTERM', () => void shutdown())
  process.once('SIGINT', () => void shutdown())

  await app.listen({ host: config.host, port: config.port })
}

void start().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
