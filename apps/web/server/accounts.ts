import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import type { AuthenticatedUser } from './database'
import { decodeAvatarDataUrl, normalizeDisplayName, normalizeProfileTitle } from './accountValidation'
import { ApiError, jsonBody } from './http'
import { createOpaqueToken, hashPassword, hashToken, normalizeEmail, verifyPassword } from './security'

const PASSWORD_LINK_DAYS = 7

interface AccountRow extends AuthenticatedUser {
  created_at: Date
  deleted_at: Date | null
}

interface InviteRow extends QueryResultRow {
  email: string
  display_name: string
  expires_at: Date
  password_hash: string | null
  used_at: Date | null
}

interface InviteLookupRow extends QueryResultRow {
  user_id: string
}

interface AccountRoutesOptions {
  app: FastifyInstance
  pool: Pool
  publicUrl: string
  requireUser: (request: FastifyRequest) => Promise<AuthenticatedUser>
  requireOwner: (request: FastifyRequest) => Promise<AuthenticatedUser>
  createSession: (userId: string, reply: FastifyReply) => Promise<void>
}

function addDays(days: number): Date {
  const value = new Date()
  value.setUTCDate(value.getUTCDate() + days)
  return value
}

export function profileAvatarUrl(user: Pick<AuthenticatedUser, 'id' | 'avatar_mime_type' | 'avatar_updated_at'>): string | null {
  return user.avatar_mime_type && user.avatar_updated_at
    ? `/api/users/${user.id}/avatar?v=${user.avatar_updated_at.getTime()}`
    : null
}

export function publicProfile(user: AuthenticatedUser): {
  id: string
  email: string
  role: AuthenticatedUser['role']
  displayName: string
  title: string
  avatarUrl: string | null
} {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.display_name,
    title: user.title,
    avatarUrl: profileAvatarUrl(user)
  }
}

function accountResponse(user: AccountRow): ReturnType<typeof publicProfile> & {
  protected: boolean
  active: boolean
  createdAt: string
} {
  return {
    ...publicProfile(user),
    protected: user.is_protected,
    active: Boolean(user.password_hash),
    createdAt: user.created_at.toISOString()
  }
}

async function loadAccount(pool: Pool, userId: string): Promise<AccountRow> {
  const result = await pool.query<AccountRow>(
    `SELECT id, email, password_hash, role, display_name, title, avatar_mime_type,
            avatar_updated_at, is_protected, created_at, deleted_at
     FROM cueport_users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  )
  if (!result.rows[0]) throw new ApiError(404, 'The account does not exist.')
  return result.rows[0]
}

type DatabaseWriter = Pick<Pool | PoolClient, 'query'>

async function createPasswordLink(database: DatabaseWriter, publicUrl: string, userId: string, ownerId: string): Promise<string> {
  const token = createOpaqueToken()
  await database.query('DELETE FROM cueport_account_invites WHERE user_id = $1 AND used_at IS NULL', [userId])
  await database.query(
    `INSERT INTO cueport_account_invites (token_hash, user_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashToken(token), userId, ownerId, addDays(PASSWORD_LINK_DAYS)]
  )
  return `${publicUrl}/?activate=${encodeURIComponent(token)}`
}

function validAvatar(value: unknown): ReturnType<typeof decodeAvatarDataUrl> {
  try {
    return decodeAvatarDataUrl(value)
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'Choose a valid profile picture.')
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

export function registerAccountRoutes({
  app,
  pool,
  publicUrl,
  requireUser,
  requireOwner,
  createSession
}: AccountRoutesOptions): void {
  app.get('/api/auth/invite/:token', async (request) => {
    const { token } = request.params as { token: string }
    const result = await pool.query<InviteRow>(
      `SELECT users.email, users.display_name, users.password_hash, invites.expires_at, invites.used_at
       FROM cueport_account_invites invites
       JOIN cueport_users users ON users.id = invites.user_id
       WHERE invites.token_hash = $1 AND users.deleted_at IS NULL`,
      [hashToken(token)]
    )
    const invite = result.rows[0]
    if (!invite || invite.used_at || invite.expires_at <= new Date()) throw new ApiError(404, 'This password link is unavailable.')
    return {
      active: Boolean(invite.password_hash),
      email: invite.email,
      displayName: invite.display_name,
      expiresAt: invite.expires_at.toISOString()
    }
  })

  app.post('/api/auth/activate', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
  }, async (request, reply) => {
    const body = jsonBody(request.body)
    if (typeof body.token !== 'string') throw new ApiError(400, 'This password link is invalid.')

    // Reject random tokens before performing the intentionally expensive
    // password hash. The transaction below repeats this check under locks.
    const tokenHash = hashToken(body.token)
    const lookup = await pool.query<InviteLookupRow>(
      `SELECT invites.user_id
       FROM cueport_account_invites invites
       JOIN cueport_users users ON users.id = invites.user_id
       WHERE invites.token_hash = $1
         AND invites.used_at IS NULL
         AND invites.expires_at > now()
         AND users.deleted_at IS NULL`,
      [tokenHash]
    )
    if (!lookup.rows[0]) throw new ApiError(404, 'This password link is unavailable.')

    const passwordHash = await hashPassword(body.password).catch((error) => {
      throw new ApiError(400, error instanceof Error ? error.message : 'Choose a valid password.')
    })
    const client = await pool.connect()
    let activatedUserId: string
    try {
      await client.query('BEGIN')
      await client.query('SELECT id FROM cueport_users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [lookup.rows[0].user_id])
      const result = await client.query<{ user_id: string; expires_at: Date; used_at: Date | null }>(
        `SELECT invites.user_id, invites.expires_at, invites.used_at
         FROM cueport_account_invites invites
         JOIN cueport_users users ON users.id = invites.user_id
         WHERE invites.token_hash = $1 AND users.deleted_at IS NULL
         FOR UPDATE`,
        [tokenHash]
      )
      const invite = result.rows[0]
      if (!invite || invite.used_at || invite.expires_at <= new Date()) throw new ApiError(404, 'This password link is unavailable.')
      await client.query('UPDATE cueport_users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, invite.user_id])
      // A password link doubles as account activation and recovery. Invalidate every prior login
      // and every outstanding link before issuing the fresh browser session.
      await client.query('DELETE FROM cueport_sessions WHERE user_id = $1', [invite.user_id])
      await client.query('DELETE FROM cueport_api_tokens WHERE user_id = $1', [invite.user_id])
      await client.query('UPDATE cueport_account_invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [invite.user_id])
      await client.query('COMMIT')
      activatedUserId = invite.user_id
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    await createSession(activatedUserId, reply)
    return { user: publicProfile(await loadAccount(pool, activatedUserId)) }
  })

  app.get('/api/accounts', async (request) => {
    await requireOwner(request)
    const result = await pool.query<AccountRow>(
      `SELECT id, email, password_hash, role, display_name, title, avatar_mime_type,
              avatar_updated_at, is_protected, created_at, deleted_at
       FROM cueport_users WHERE deleted_at IS NULL
       ORDER BY is_protected DESC, created_at ASC`
    )
    return { accounts: result.rows.map(accountResponse) }
  })

  app.post('/api/accounts', async (request) => {
    const owner = await requireOwner(request)
    const body = jsonBody(request.body)
    let email: string
    let displayName: string
    let title: string
    try {
      email = normalizeEmail(body.email)
      displayName = normalizeDisplayName(body.displayName)
      title = normalizeProfileTitle(body.title)
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'Enter valid account details.')
    }
    const avatar = validAvatar(body.avatarDataUrl)
    const userId = randomUUID()
    const client = await pool.connect()
    let setupUrl: string
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO cueport_users
           (id, email, role, display_name, title, avatar_mime_type, avatar_data, avatar_updated_at)
         VALUES ($1, $2, 'member', $3, $4, $5, $6, CASE WHEN $6::bytea IS NULL THEN NULL ELSE now() END)`,
        [userId, email, displayName, title, avatar?.mimeType ?? null, avatar?.data ?? null]
      )
      setupUrl = await createPasswordLink(client, publicUrl, userId, owner.id)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      if (isUniqueViolation(error)) throw new ApiError(409, 'An account with this email address already exists.')
      throw error
    } finally {
      client.release()
    }
    return { account: accountResponse(await loadAccount(pool, userId)), setupUrl }
  })

  app.patch('/api/accounts/:userId', async (request) => {
    await requireOwner(request)
    const { userId } = request.params as { userId: string }
    const existing = await loadAccount(pool, userId)
    const body = jsonBody(request.body)
    let email = existing.email
    let displayName: string
    let title: string
    try {
      if (!existing.is_protected && body.email !== undefined) email = normalizeEmail(body.email)
      displayName = normalizeDisplayName(body.displayName ?? existing.display_name)
      title = normalizeProfileTitle(body.title ?? existing.title)
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'Enter valid account details.')
    }
    const avatar = body.avatarDataUrl === undefined ? undefined : validAvatar(body.avatarDataUrl)
    try {
      await pool.query(
        `UPDATE cueport_users SET
           email = $1,
           display_name = $2,
           title = $3,
           avatar_mime_type = CASE WHEN $4::boolean THEN $5 ELSE avatar_mime_type END,
           avatar_data = CASE WHEN $4::boolean THEN $6 ELSE avatar_data END,
           avatar_updated_at = CASE WHEN $4::boolean THEN CASE WHEN $6::bytea IS NULL THEN NULL ELSE now() END ELSE avatar_updated_at END,
           updated_at = now()
         WHERE id = $7 AND deleted_at IS NULL`,
        [email, displayName, title, avatar !== undefined, avatar?.mimeType ?? null, avatar?.data ?? null, userId]
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, 'An account with this email address already exists.')
      throw error
    }
    return { account: accountResponse(await loadAccount(pool, userId)) }
  })

  const issuePasswordLink = async (request: FastifyRequest): Promise<string> => {
    const owner = await requireOwner(request)
    const { userId } = request.params as { userId: string }
    const account = await loadAccount(pool, userId)
    if (account.is_protected) throw new ApiError(400, 'Change the owner password from the profile menu.')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // The account row is the serialization point: two simultaneous requests
      // can never leave two usable password links behind.
      await client.query('SELECT id FROM cueport_users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [userId])
      const passwordUrl = await createPasswordLink(client, publicUrl, userId, owner.id)
      await client.query('COMMIT')
      return passwordUrl
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  app.post('/api/accounts/:userId/password-link', async (request) => {
    return { passwordUrl: await issuePasswordLink(request) }
  })

  // Keep the original route compatible with already-open dashboard builds.
  app.post('/api/accounts/:userId/invite', async (request) => {
    return { setupUrl: await issuePasswordLink(request) }
  })

  app.delete('/api/accounts/:userId', async (request) => {
    const owner = await requireOwner(request)
    const { userId } = request.params as { userId: string }
    const account = await loadAccount(pool, userId)
    if (account.is_protected || account.role === 'owner' || account.id === owner.id) {
      throw new ApiError(403, 'The Cueport owner account cannot be deleted.')
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM cueport_sessions WHERE user_id = $1', [userId])
      await client.query('DELETE FROM cueport_api_tokens WHERE user_id = $1', [userId])
      await client.query('DELETE FROM cueport_account_invites WHERE user_id = $1', [userId])
      await client.query(
        `UPDATE cueport_users SET
           email = $1,
           password_hash = NULL,
           display_name = 'Deleted account',
           title = '',
           avatar_mime_type = NULL,
           avatar_data = NULL,
           avatar_updated_at = NULL,
           deleted_at = now(),
           updated_at = now()
         WHERE id = $2`,
        [`deleted-${userId}@deleted.invalid`, userId]
      )
      await client.query('COMMIT')
      return { success: true }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  app.patch('/api/profile', async (request) => {
    const user = await requireUser(request)
    const body = jsonBody(request.body)
    let displayName: string
    let title: string
    try {
      displayName = normalizeDisplayName(body.displayName ?? user.display_name)
      title = normalizeProfileTitle(body.title ?? user.title)
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : 'Enter valid profile details.')
    }
    const avatar = body.avatarDataUrl === undefined ? undefined : validAvatar(body.avatarDataUrl)
    await pool.query(
      `UPDATE cueport_users SET
         display_name = $1,
         title = $2,
         avatar_mime_type = CASE WHEN $3::boolean THEN $4 ELSE avatar_mime_type END,
         avatar_data = CASE WHEN $3::boolean THEN $5 ELSE avatar_data END,
         avatar_updated_at = CASE WHEN $3::boolean THEN CASE WHEN $5::bytea IS NULL THEN NULL ELSE now() END ELSE avatar_updated_at END,
         updated_at = now()
       WHERE id = $6 AND deleted_at IS NULL`,
      [displayName, title, avatar !== undefined, avatar?.mimeType ?? null, avatar?.data ?? null, user.id]
    )
    return { user: publicProfile(await loadAccount(pool, user.id)) }
  })

  app.post('/api/profile/password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
  }, async (request, reply) => {
    const user = await requireUser(request)
    const body = jsonBody(request.body)
    if (!(await verifyPassword(body.currentPassword, user.password_hash))) {
      throw new ApiError(401, 'The current password is incorrect.')
    }
    if (body.currentPassword === body.newPassword) {
      throw new ApiError(400, 'Choose a new password that is different from the current password.')
    }
    const passwordHash = await hashPassword(body.newPassword).catch((error) => {
      throw new ApiError(400, error instanceof Error ? error.message : 'Choose a valid password.')
    })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const changed = await client.query<{ id: string }>(
        `UPDATE cueport_users
         SET password_hash = $1, updated_at = now()
         WHERE id = $2 AND password_hash = $3 AND deleted_at IS NULL
         RETURNING id`,
        [passwordHash, user.id, user.password_hash]
      )
      if (!changed.rows[0]) throw new ApiError(409, 'The password changed in another session. Sign in again and retry.')
      // A password change is also a credential-recovery boundary. Keep only
      // the fresh browser session created after this transaction commits.
      await client.query('DELETE FROM cueport_sessions WHERE user_id = $1', [user.id])
      await client.query('DELETE FROM cueport_api_tokens WHERE user_id = $1', [user.id])
      await client.query('UPDATE cueport_account_invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    await createSession(user.id, reply)
    return { success: true }
  })

  app.get('/api/users/:userId/avatar', async (request, reply) => {
    await requireUser(request)
    const { userId } = request.params as { userId: string }
    const result = await pool.query<{ avatar_mime_type: string; avatar_data: Buffer }>(
      `SELECT avatar_mime_type, avatar_data FROM cueport_users
       WHERE id = $1 AND deleted_at IS NULL AND avatar_data IS NOT NULL`,
      [userId]
    )
    const avatar = result.rows[0]
    if (!avatar) throw new ApiError(404, 'The profile picture is unavailable.')
    reply.header('Cache-Control', 'private, max-age=300')
    reply.type(avatar.avatar_mime_type)
    return reply.send(avatar.avatar_data)
  })
}
