import { describe, expect, it } from 'vitest'
import { coordinateToPpm, normalizeCommentBody, normalizeSlideId, ppmToCoordinate } from './commentValidation'

describe('discussion input validation', () => {
  it('preserves deliberate line breaks while trimming the message', () => {
    expect(normalizeCommentBody('  First line\r\nSecond line  ')).toBe('First line\nSecond line')
  })

  it('rejects empty and oversized messages', () => {
    expect(() => normalizeCommentBody('   ')).toThrow(/write a comment/i)
    expect(() => normalizeCommentBody('x'.repeat(4001))).toThrow(/shorter/i)
  })

  it('round-trips normalized artwork coordinates without floating drift', () => {
    expect(coordinateToPpm(0.1234564)).toBe(123456)
    expect(ppmToCoordinate(750000)).toBe(0.75)
    expect(() => coordinateToPpm(1.01)).toThrow(/inside the layout/i)
  })

  it('accepts only stable UUID slide identities', () => {
    expect(normalizeSlideId('A0EBC999-9C0B-4EF8-A6C8-5D9429895834')).toBe('a0ebc999-9c0b-4ef8-a6c8-5d9429895834')
    expect(() => normalizeSlideId('../slide')).toThrow(/invalid/i)
  })
})
