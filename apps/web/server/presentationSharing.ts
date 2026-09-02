import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import type { AccountRole } from '../../../src/shared/accounts'
import { requirePresentationManager } from './authorization'
import type { AuthenticatedUser } from './database'
import { withTransaction } from './database'
import { ApiError, jsonBody } from './http'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface PresentationSharingRoutesOptions {
  app: FastifyInstance
  pool: Pool
  requireEditor: (request: FastifyRequest) => Promise<AuthenticatedUser>
}

interface SharingAccountRow {
  id: string
  email: string
  display_name: string
  title: string
  role: AccountRole
  active: boolean
  granted: boolean
}

function requestedAccountIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200) throw new ApiError(400, 'Choose valid Cueport accounts.')
  const ids = value.map((candidate) => {
    if (typeof candidate !== 'string' || !UUID_PATTERN.test(candidate)) {
      throw new ApiError(400, 'Choose valid Cueport accounts.')
    }
    return candidate.toLowerCase()
  })
  if (new Set(ids).size !== ids.length) throw new ApiError(400, 'An account was selected more than once.')
  return ids
}

export function registerPresentationSharingRoutes({
  app,
  pool,
  requireEditor
}: PresentationSharingRoutesOptions): void {
  app.get('/api/presentations/:presentationId/access', async (request) => {
    const editor = await requireEditor(request)
    const { presentationId } = request.params as { presentationId: string }
    const management = await requirePresentationManager(pool, presentationId, editor)
    const presentation = await pool.query<{ is_public: boolean }>(
      'SELECT is_public FROM cueport_presentations WHERE id = $1',
      [presentationId]
    )
    if (!presentation.rows[0]) throw new ApiError(404, 'The presentation does not exist.')
    const accounts = await pool.query<SharingAccountRow>(
      `SELECT users.id, users.email, users.display_name, users.title, users.role,
              users.password_hash IS NOT NULL AS active,
              access.user_id IS NOT NULL AS granted
       FROM cueport_users users
       LEFT JOIN cueport_presentation_access access
         ON access.user_id = users.id AND access.presentation_id = $1
       WHERE users.role <> 'owner' AND users.id <> $2 AND users.deleted_at IS NULL
       ORDER BY users.display_name ASC, users.email ASC`,
      [presentationId, management!.ownerId]
    )
    return {
      isPublic: presentation.rows[0].is_public,
      accounts: accounts.rows.map((account) => ({
        id: account.id,
        email: account.email,
        displayName: account.display_name,
        title: account.title,
        role: account.role,
        active: account.active,
        granted: account.granted
      }))
    }
  })

  app.put('/api/presentations/:presentationId/access', async (request) => {
    const editor = await requireEditor(request)
    const { presentationId } = request.params as { presentationId: string }
    const body = jsonBody(request.body)
    if (typeof body.isPublic !== 'boolean') throw new ApiError(400, 'Choose a valid link access setting.')
    const accountIds = requestedAccountIds(body.accountIds)

    await withTransaction(pool, async (client) => {
      const management = await requirePresentationManager(client, presentationId, editor)
      await client.query('SELECT id FROM cueport_presentations WHERE id = $1 FOR UPDATE', [presentationId])
      await client.query(
        'UPDATE cueport_presentations SET is_public = $1, updated_at = now() WHERE id = $2',
        [body.isPublic, presentationId]
      )
      await client.query('DELETE FROM cueport_presentation_access WHERE presentation_id = $1', [presentationId])
      if (accountIds.length === 0) return
      const inserted = await client.query(
        `INSERT INTO cueport_presentation_access (presentation_id, user_id, granted_by)
         SELECT $1, users.id, $2
         FROM cueport_users users
         WHERE users.id = ANY($3::uuid[])
           AND users.id <> $4
           AND users.role IN ('viewer', 'editor', 'admin')
           AND users.deleted_at IS NULL
         RETURNING user_id`,
        [presentationId, editor.id, accountIds, management!.ownerId]
      )
      if (inserted.rowCount !== accountIds.length) throw new ApiError(400, 'One selected account is unavailable.')
    })
    return { success: true }
  })
}
