import { randomUUID, timingSafeEqual } from 'node:crypto'
import { access, mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Readable } from 'node:stream'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import type { QueryResultRow } from 'pg'
import { parsePresentationDocument, type PresentationDocument } from '../../../src/shared/presentation'
import { createDatabase, runMigrations, type AuthenticatedUser, withTransaction } from './database'
import { PUBLICATION_PREVIEW_ASSET_KEY } from '../../../src/shared/projects'
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
  storeUpload
} from './storage'
import { ApiError, jsonBody } from './http'
import { publicProfile, registerAccountRoutes } from './accounts'
import { registerDiscussionRoutes } from './discussions'
import { registerDownloadRoutes } from './downloads'

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
}

interface DraftRequestBody {
  document: unknown
  assets: DraftAssetInput[]
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
  status: string
  owner_id: string
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
    if (!user || user.role !== 'owner' || !(await verifyPassword(body.password, user.password_hash))) {
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
    requireOwner,
    createSession
  })
  registerDiscussionRoutes({ app, pool, requireUser })
  registerDownloadRoutes({ app, pool, storageRoot: config.storageRoot, requireUser })

  app.post('/api/publications/drafts', async (request) => {
    const owner = await requireOwner(request)
    const body = request.body as DraftRequestBody
    const document = parsePresentationDocument(body?.document)
    if (document.brand?.mimeType === 'image/svg+xml') {
      throw new ApiError(400, 'Use a PNG, JPEG, or WebP client mark for web publishing. SVG remains available in the desktop app.')
    }
    if (!Array.isArray(body?.assets)) throw new ApiError(400, 'The publication has no asset list.')
    const includePreview = body.assets.some((asset) => asset?.key === PUBLICATION_PREVIEW_ASSET_KEY)
    const expected = collectExpectedAssets(document, includePreview)
    const provided = new Map<string, DraftAssetInput>()
    let totalBytes = 0
    for (const asset of body.assets) {
      const bytes = Number(asset?.bytes)
      if (!asset || typeof asset.key !== 'string' || typeof asset.mimeType !== 'string' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_ASSET_BYTES) {
        throw new ApiError(400, 'One of the publication assets is invalid or too large.')
      }
      if (provided.has(asset.key)) throw new ApiError(400, 'The publication repeats an asset.')
      provided.set(asset.key, { key: asset.key, mimeType: asset.mimeType, bytes })
      totalBytes += bytes
    }
    if (totalBytes > MAX_PUBLICATION_BYTES) throw new ApiError(413, 'The publication is too large.')
    if (expected.length !== provided.size || expected.some((asset) => provided.get(asset.key)?.mimeType !== asset.mimeType)) {
      throw new ApiError(400, 'The publication assets do not match its presentation document.')
    }

    const draft = await withTransaction(pool, async (client) => {
      const existing = await client.query<{ owner_id: string }>(
        'SELECT owner_id FROM cueport_presentations WHERE id = $1 FOR UPDATE',
        [document.id]
      )
      if (existing.rows[0] && existing.rows[0].owner_id !== owner.id) throw new ApiError(403, 'This presentation belongs to another account.')
      await client.query(
        `INSERT INTO cueport_presentations (id, owner_id, name)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [document.id, owner.id, document.name]
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
      const uploads: Array<{ id: string; key: string }> = []
      for (const asset of expected) {
        const input = provided.get(asset.key)!
        const id = randomUUID()
        const storageName = storageNameForAsset(id, asset.mimeType)
        await client.query(
          `INSERT INTO cueport_revision_assets
             (id, revision_id, asset_key, mime_type, expected_bytes, storage_name)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, revisionId, asset.key, asset.mimeType, input.bytes, storageName]
        )
        uploads.push({ id, key: asset.key })
      }
      return { revisionId, revisionNumber, uploads }
    })

    return {
      revisionId: draft.revisionId,
      revisionNumber: draft.revisionNumber,
      uploads: draft.uploads.map((asset) => ({
        key: asset.key,
        url: `/api/publications/revisions/${draft.revisionId}/assets/${asset.id}`
      }))
    }
  })

  app.put('/api/publications/revisions/:revisionId/assets/:assetId', { bodyLimit: MAX_ASSET_BYTES }, async (request) => {
    const owner = await requireOwner(request)
    const { revisionId, assetId } = request.params as { revisionId: string; assetId: string }
    const result = await pool.query<AssetRow>(
      `SELECT assets.*, revisions.status, presentations.owner_id
       FROM cueport_revision_assets assets
       JOIN cueport_revisions revisions ON revisions.id = assets.revision_id
       JOIN cueport_presentations presentations ON presentations.id = revisions.presentation_id
       WHERE assets.id = $1 AND revisions.id = $2`,
      [assetId, revisionId]
    )
    const asset = result.rows[0]
    if (!asset || asset.owner_id !== owner.id) throw new ApiError(404, 'The upload target does not exist.')
    if (asset.status !== 'draft') throw new ApiError(409, 'This revision is already published.')
    if (request.headers['content-type']?.split(';')[0] !== asset.mime_type) throw new ApiError(415, 'The upload type does not match the publication.')
    const expectedBytes = Number(asset.expected_bytes)
    if (Number(request.headers['content-length']) !== expectedBytes) throw new ApiError(400, 'The upload size does not match the publication.')
    const destination = storedAssetPath(config.storageRoot, revisionId, asset.storage_name)
    const storedBytes = await storeUpload(request.body as Readable, destination, expectedBytes)
    await pool.query(
      'UPDATE cueport_revision_assets SET stored_bytes = $1, uploaded_at = now() WHERE id = $2',
      [storedBytes, asset.id]
    )
    return { success: true }
  })

  app.post('/api/publications/revisions/:revisionId/commit', async (request) => {
    const owner = await requireOwner(request)
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
      if (!row || row.owner_id !== owner.id) throw new ApiError(404, 'The publication draft does not exist.')
      if (row.status !== 'draft') throw new ApiError(409, 'This revision is already published.')
      const missing = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM cueport_revision_assets
         WHERE revision_id = $1 AND (stored_bytes IS NULL OR stored_bytes <> expected_bytes)`,
        [revisionId]
      )
      if (Number(missing.rows[0]?.count) > 0) throw new ApiError(409, 'Finish all asset uploads before publishing.')

      const token = row.share_token_cipher ? decryptToken(row.share_token_cipher, config.secret) : createOpaqueToken()
      const cipher = row.share_token_cipher ?? encryptToken(token, config.secret)
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
      return { token, revisionNumber: row.revision_number }
    })
    return { shareUrl: `${config.publicUrl}/p/${result.token}`, revisionNumber: result.revisionNumber }
  })

  app.get('/api/presentations', async (request) => {
    const owner = await requireOwner(request)
    const result = await pool.query<{
      id: string
      name: string
      updated_at: Date
      share_token_cipher: string | null
      revision_number: number | null
      document: PresentationDocument | null
    }>(
      `SELECT presentations.id, presentations.name, presentations.updated_at,
              presentations.share_token_cipher, revisions.revision_number, revisions.document
       FROM cueport_presentations presentations
       LEFT JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
       WHERE presentations.owner_id = $1
       ORDER BY presentations.updated_at DESC`,
      [owner.id]
    )
    return {
      presentations: result.rows.map((row) => {
        const document = row.document ? parsePresentationDocument(row.document) : null
        return {
          id: row.id,
          name: row.name,
          updatedAt: row.updated_at.toISOString(),
          revisionNumber: row.revision_number,
          slideCount: document?.slides.length ?? 0,
          shareUrl: shareUrl(config, row.share_token_cipher),
          thumbnailUrl: document && preferredDashboardThumbnailKeys(document).length > 0
            ? `/api/presentations/${row.id}/thumbnail?v=${row.revision_number ?? 0}`
            : null
        }
      })
    }
  })

  app.get('/api/presentations/:presentationId/thumbnail', async (request, reply) => {
    const owner = await requireOwner(request)
    const { presentationId } = request.params as { presentationId: string }
    const published = await pool.query<{ revision_id: string; document: unknown }>(
      `SELECT revisions.id AS revision_id, revisions.document
       FROM cueport_presentations presentations
       JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
       WHERE presentations.id = $1 AND presentations.owner_id = $2`,
      [presentationId, owner.id]
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
    const owner = await requireOwner(request)
    const { presentationId } = request.params as { presentationId: string }
    let name: string
    try {
      name = normalizePresentationName(jsonBody(request.body).name)
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'Enter a presentation name.')
    }
    const result = await pool.query(
      `UPDATE cueport_presentations SET name = $1, updated_at = now()
       WHERE id = $2 AND owner_id = $3`,
      [name, presentationId, owner.id]
    )
    if (!result.rowCount) throw new ApiError(404, 'The presentation does not exist.')
    return { success: true, name }
  })

  app.post('/api/presentations/:presentationId/revoke', async (request) => {
    const owner = await requireOwner(request)
    const { presentationId } = request.params as { presentationId: string }
    const result = await pool.query(
      `UPDATE cueport_presentations
       SET share_token_hash = NULL, share_token_cipher = NULL, updated_at = now()
       WHERE id = $1 AND owner_id = $2`,
      [presentationId, owner.id]
    )
    if (!result.rowCount) throw new ApiError(404, 'The presentation does not exist.')
    return { success: true }
  })

  app.delete('/api/presentations/:presentationId', async (request) => {
    const owner = await requireOwner(request)
    const { presentationId } = request.params as { presentationId: string }
    const revisions = await pool.query<{ id: string }>(
      `SELECT revisions.id FROM cueport_revisions revisions
       JOIN cueport_presentations presentations ON presentations.id = revisions.presentation_id
       WHERE presentations.id = $1 AND presentations.owner_id = $2`,
      [presentationId, owner.id]
    )
    const result = await pool.query('DELETE FROM cueport_presentations WHERE id = $1 AND owner_id = $2', [presentationId, owner.id])
    if (!result.rowCount) throw new ApiError(404, 'The presentation does not exist.')
    await Promise.all(revisions.rows.map((revision) => removeRevisionStorage(config.storageRoot, revision.id)))
    return { success: true }
  })

  app.get('/api/share/:token', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request) => {
    await requireUser(request)
    const { token } = request.params as { token: string }
    if (token.length < 32 || token.length > 128) throw new ApiError(404, 'This presentation link is unavailable.')
    const result = await pool.query<{
      revision_id: string
      document: unknown
    }>(
      `SELECT revisions.id AS revision_id, revisions.document
       FROM cueport_presentations presentations
       JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
       WHERE presentations.share_token_hash = $1 AND revisions.status = 'published'`,
      [hashToken(token)]
    )
    const published = result.rows[0]
    if (!published) throw new ApiError(404, 'This presentation link is unavailable.')
    const document = parsePresentationDocument(published.document)
    const assets = await pool.query<{ id: string; asset_key: string }>(
      'SELECT id, asset_key FROM cueport_revision_assets WHERE revision_id = $1',
      [published.revision_id]
    )
    return {
      document,
      assets: Object.fromEntries(assets.rows.map((asset) => [
        asset.asset_key,
        `/api/share/${encodeURIComponent(token)}/assets/${asset.id}`
      ]))
    }
  })

  app.get('/api/share/:token/assets/:assetId', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (request, reply) => {
    await requireUser(request)
    const { token, assetId } = request.params as { token: string; assetId: string }
    const result = await pool.query<{
      revision_id: string
      mime_type: string
      storage_name: string
    }>(
      `SELECT assets.revision_id, assets.mime_type, assets.storage_name
       FROM cueport_presentations presentations
       JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
       JOIN cueport_revision_assets assets ON assets.revision_id = revisions.id
       WHERE presentations.share_token_hash = $1 AND assets.id = $2 AND assets.uploaded_at IS NOT NULL`,
      [hashToken(token), assetId]
    )
    const asset = result.rows[0]
    if (!asset) throw new ApiError(404, 'The presentation asset is unavailable.')
    const filePath = storedAssetPath(config.storageRoot, asset.revision_id, asset.storage_name)
    const file = await stat(filePath)
    const range = request.headers.range
    reply.header('Accept-Ranges', 'bytes')
    reply.header('Cache-Control', 'private, max-age=3600')
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
