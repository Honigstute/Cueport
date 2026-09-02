import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from './database'
import { requireAccountAdminRole, requireEditorRole, requirePresentationManager } from './authorization'

function user(role: AuthenticatedUser['role']): AuthenticatedUser {
  return { role } as AuthenticatedUser
}

function account(id: string, role: AuthenticatedUser['role']): AuthenticatedUser {
  return { id, role } as AuthenticatedUser
}

function presentationDatabase(ownerId?: string, hasGrant = false): Pool {
  return {
    query: vi.fn().mockResolvedValue({
      rows: ownerId ? [{ owner_id: ownerId, has_grant: hasGrant }] : []
    })
  } as unknown as Pool
}

describe('global account capabilities', () => {
  it('keeps Viewer accounts read-only while allowing comments elsewhere', () => {
    expect(() => requireEditorRole(user('viewer'))).toThrow(/Editor account/i)
    expect(() => requireAccountAdminRole(user('viewer'))).toThrow(/admin/i)
  })

  it('lets Editors change presentations but not accounts', () => {
    expect(requireEditorRole(user('editor')).role).toBe('editor')
    expect(() => requireAccountAdminRole(user('editor'))).toThrow(/admin/i)
  })

  it('gives Admin and Owner the cumulative management capabilities', () => {
    for (const role of ['admin', 'owner'] as const) {
      expect(requireEditorRole(user(role)).role).toBe(role)
      expect(requireAccountAdminRole(user(role)).role).toBe(role)
    }
  })
})

describe('presentation-scoped editing', () => {
  it('lets the Owner manage every presentation', async () => {
    await expect(requirePresentationManager(
      presentationDatabase('another-account'),
      'presentation-id',
      account('cueport-owner', 'owner')
    )).resolves.toEqual({ ownerId: 'another-account', hasGrant: false })
  })

  it('lets Editors manage presentations they own or were granted', async () => {
    await expect(requirePresentationManager(
      presentationDatabase('editor-id'),
      'presentation-id',
      account('editor-id', 'editor')
    )).resolves.toMatchObject({ ownerId: 'editor-id' })
    await expect(requirePresentationManager(
      presentationDatabase('creator-id', true),
      'presentation-id',
      account('editor-id', 'editor')
    )).resolves.toEqual({ ownerId: 'creator-id', hasGrant: true })
  })

  it('rejects unassigned Editors and every Viewer', async () => {
    await expect(requirePresentationManager(
      presentationDatabase('creator-id'),
      'presentation-id',
      account('editor-id', 'editor')
    )).rejects.toThrow(/not been shared/i)
    await expect(requirePresentationManager(
      presentationDatabase('viewer-id'),
      'presentation-id',
      account('viewer-id', 'viewer')
    )).rejects.toThrow(/Editor account/i)
  })
})
