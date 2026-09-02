import { describe, expect, it } from 'vitest'
import { presentationAccessDecision } from './presentationAccess'

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
})
