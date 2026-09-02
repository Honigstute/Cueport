/** Global Cueport capabilities. Presentation grants still decide which decks a user can open. */
export const ACCOUNT_ROLES = ['owner', 'viewer', 'editor', 'admin'] as const
export const ASSIGNABLE_ACCOUNT_ROLES = ['viewer', 'editor', 'admin'] as const

export type AccountRole = (typeof ACCOUNT_ROLES)[number]
export type AssignableAccountRole = (typeof ASSIGNABLE_ACCOUNT_ROLES)[number]

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && ACCOUNT_ROLES.includes(value as AccountRole)
}

export function isAssignableAccountRole(value: unknown): value is AssignableAccountRole {
  return typeof value === 'string' && ASSIGNABLE_ACCOUNT_ROLES.includes(value as AssignableAccountRole)
}

export function canEditPresentations(role: AccountRole): boolean {
  return role === 'owner' || role === 'editor' || role === 'admin'
}

export function canManageAccounts(role: AccountRole): boolean {
  return role === 'owner' || role === 'admin'
}

