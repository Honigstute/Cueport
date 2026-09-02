import type { Pool, QueryResultRow } from 'pg'
import { parsePresentationDocument, type PresentationDocument } from '../../../src/shared/presentation'
import type { AuthenticatedUser } from './database'
import { ApiError } from './http'
import { hashToken } from './security'

interface PublishedPresentationRow extends QueryResultRow {
  presentation_id: string
  owner_id: string
  revision_id: string
  document: unknown
  is_public: boolean
}

export interface PublishedPresentationContext {
  presentationId: string
  ownerId: string
  revisionId: string
  document: PresentationDocument
  isPublic: boolean
}

export type PresentationAccessDecision = 'allow' | 'login' | 'deny'

/** One policy for viewer data, assets, downloads, and discussions. */
export function presentationAccessDecision(
  context: Pick<PublishedPresentationContext, 'isPublic' | 'ownerId'>,
  user: Pick<AuthenticatedUser, 'id' | 'role'> | null,
  hasGrant: boolean
): PresentationAccessDecision {
  if (context.isPublic) return 'allow'
  if (!user) return 'login'
  return user.role === 'owner' || user.id === context.ownerId || hasGrant ? 'allow' : 'deny'
}

export async function loadPublishedPresentation(
  pool: Pool,
  token: string
): Promise<PublishedPresentationContext> {
  if (token.length < 32 || token.length > 128) {
    throw new ApiError(404, 'This presentation link is unavailable.')
  }
  const result = await pool.query<PublishedPresentationRow>(
    `SELECT presentations.id AS presentation_id, presentations.owner_id,
            presentations.is_public, revisions.id AS revision_id, revisions.document
     FROM cueport_presentations presentations
     JOIN cueport_revisions revisions ON revisions.id = presentations.published_revision_id
     WHERE presentations.share_token_hash = $1 AND revisions.status = 'published'`,
    [hashToken(token)]
  )
  const row = result.rows[0]
  if (!row) throw new ApiError(404, 'This presentation link is unavailable.')
  return {
    presentationId: row.presentation_id,
    ownerId: row.owner_id,
    revisionId: row.revision_id,
    document: parsePresentationDocument(row.document),
    isPublic: row.is_public
  }
}

export async function requirePublishedPresentationAccess(
  pool: Pool,
  token: string,
  user: AuthenticatedUser | null
): Promise<PublishedPresentationContext> {
  const context = await loadPublishedPresentation(pool, token)
  let hasGrant = false
  if (user && !context.isPublic && user.id !== context.ownerId) {
    const grant = await pool.query(
      `SELECT 1 FROM cueport_presentation_access
       WHERE presentation_id = $1 AND user_id = $2`,
      [context.presentationId, user.id]
    )
    hasGrant = Boolean(grant.rowCount)
  }
  const decision = presentationAccessDecision(context, user, hasGrant)
  if (decision === 'login') throw new ApiError(401, 'Sign in to open this presentation.')
  if (decision === 'deny') throw new ApiError(403, 'This presentation has not been shared with your account.')
  return context
}
