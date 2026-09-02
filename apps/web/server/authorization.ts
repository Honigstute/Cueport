import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { canEditPresentations, canManageAccounts } from '../../../src/shared/accounts'
import type { AuthenticatedUser } from './database'
import { ApiError } from './http'

type DatabaseReader = Pick<Pool | PoolClient, 'query'>

interface PresentationPermissionRow extends QueryResultRow {
  owner_id: string
  has_grant: boolean
}

export interface PresentationManagementContext {
  ownerId: string
  hasGrant: boolean
}

export function requireAccountAdminRole(user: AuthenticatedUser): AuthenticatedUser {
  if (!canManageAccounts(user.role)) throw new ApiError(403, 'Only a Cueport admin can manage accounts.')
  return user
}

export function requireEditorRole(user: AuthenticatedUser): AuthenticatedUser {
  if (!canEditPresentations(user.role)) throw new ApiError(403, 'An Editor account is required to change presentations.')
  return user
}

/**
 * Global role decides what someone may do; ownership or a presentation grant
 * decides where they may do it. The protected Owner is the recovery path and
 * can manage every deck without an explicit grant.
 */
export async function requirePresentationManager(
  database: DatabaseReader,
  presentationId: string,
  user: AuthenticatedUser,
  options: { allowMissing?: boolean } = {}
): Promise<PresentationManagementContext | null> {
  requireEditorRole(user)
  const result = await database.query<PresentationPermissionRow>(
    `SELECT presentations.owner_id,
            EXISTS (
              SELECT 1 FROM cueport_presentation_access access
              WHERE access.presentation_id = presentations.id AND access.user_id = $2
            ) AS has_grant
     FROM cueport_presentations presentations
     WHERE presentations.id = $1`,
    [presentationId, user.id]
  )
  const row = result.rows[0]
  if (!row) {
    if (options.allowMissing) return null
    throw new ApiError(404, 'The presentation does not exist.')
  }
  if (user.role !== 'owner' && row.owner_id !== user.id && !row.has_grant) {
    throw new ApiError(403, 'This presentation has not been shared with your Editor account.')
  }
  return { ownerId: row.owner_id, hasGrant: row.has_grant }
}

