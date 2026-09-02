import type { AccountRole } from '../../../../src/shared/accounts'

export interface UserProfile {
  id: string
  email: string
  role: AccountRole
  displayName: string
  title: string
  avatarUrl: string | null
}

export interface AccountSummary extends UserProfile {
  protected: boolean
  active: boolean
  createdAt: string
}

export interface SessionResponse {
  authenticated: boolean
  user?: UserProfile
}
