import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from './database'
import { presentationAccessDecision, requirePublishedPresentationAccess } from './presentationAccess'

function accessDatabase(hasGrant: boolean): Pool {
  return {
    query: vi.fn()
      .mockResolvedValueOnce({ rows: [{
        presentation_id: 'presentation-id',
        owner_id: 'owner-id',
        revision_id: 'revision-id',
        document: {
          schemaVersion: 1,
          id: '6a4db9b8-fb92-4f04-aa5a-4af70be67a58',
          name: 'Deck',
          createdAt: '2026-09-02T09:00:00.000Z',
          updatedAt: '2026-09-02T09:00:00.000Z',
          activeSlideId: '4530e751-d6e9-4d0a-98e4-acde98863762',
          settings: {},
          slides: [{
            id: '4530e751-d6e9-4d0a-98e4-acde98863762',
            name: 'Slide.jpg',
            width: 1920,
            height: 1080,
            assetKey: 'slides/slide.jpg',
            mimeType: 'image/jpeg'
          }],
          references: [],
          brand: null
        },
        is_public: true
      }] })
      .mockResolvedValueOnce({ rows: hasGrant ? [{ '?column?': 1 }] : [], rowCount: hasGrant ? 1 : 0 })
  } as unknown as Pool
}

function account(id: string, role: AuthenticatedUser['role']): AuthenticatedUser {
  return { id, role } as AuthenticatedUser
}

const privatePresentation = { isPublic: false, ownerId: 'owner' }

describe('presentation access policy', () => {
  it('opens public links without an account', () => {
    expect(presentationAccessDecision({ isPublic: true, ownerId: 'owner' }, null, false)).toBe('allow')
  })

  it('asks anonymous visitors to sign in for restricted links', () => {
    expect(presentationAccessDecision(privatePresentation, null, false)).toBe('login')
  })

  it('allows the owner and explicitly assigned members', () => {
    expect(presentationAccessDecision(privatePresentation, { id: 'owner', role: 'viewer' }, false)).toBe('allow')
    expect(presentationAccessDecision(privatePresentation, { id: 'member', role: 'viewer' }, true)).toBe('allow')
    expect(presentationAccessDecision(privatePresentation, { id: 'cueport-owner', role: 'owner' }, false)).toBe('allow')
  })

  it('denies unrelated signed-in accounts', () => {
    expect(presentationAccessDecision(privatePresentation, { id: 'other', role: 'editor' }, false)).toBe('deny')
  })

  it('offers editing only to capable accounts with presentation access', async () => {
    await expect(requirePublishedPresentationAccess(
      accessDatabase(true),
      'a'.repeat(40),
      account('editor-id', 'editor')
    )).resolves.toMatchObject({ canEdit: true })
    await expect(requirePublishedPresentationAccess(
      accessDatabase(true),
      'a'.repeat(40),
      account('viewer-id', 'viewer')
    )).resolves.toMatchObject({ canEdit: false })
    await expect(requirePublishedPresentationAccess(
      accessDatabase(false),
      'a'.repeat(40),
      account('editor-id', 'editor')
    )).resolves.toMatchObject({ canEdit: false })
  })
})
