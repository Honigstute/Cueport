import { describe, expect, it } from 'vitest'
import { decodeAvatarDataUrl, normalizeDisplayName, normalizeProfileTitle } from './accountValidation'

describe('account profile validation', () => {
  it('normalizes the public identity used beside comments', () => {
    expect(normalizeDisplayName('  Test   Viewer ')).toBe('Test Viewer')
    expect(normalizeProfileTitle(' Client   review ')).toBe('Client review')
  })

  it('rejects missing or oversized profile copy', () => {
    expect(() => normalizeDisplayName('')).toThrow(/display name/i)
    expect(() => normalizeProfileTitle('x'.repeat(101))).toThrow(/title/i)
  })

  it('accepts real raster signatures and rejects mislabeled data', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const avatar = decodeAvatarDataUrl(`data:image/png;base64,${png.toString('base64')}`)
    expect(avatar?.mimeType).toBe('image/png')
    expect(avatar?.data.equals(png)).toBe(true)
    expect(() => decodeAvatarDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`)).toThrow(/valid profile picture/i)
  })
})
