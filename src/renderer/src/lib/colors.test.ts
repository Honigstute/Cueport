import { describe, expect, it } from 'vitest'
import { getReadableInk, isHexColor, normalizeHex } from './colors'

describe('color input', () => {
  it('normalizes three and six digit hex colors', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC')
    expect(normalizeHex('abc')).toBe('#AABBCC')
    expect(normalizeHex(' #1f2937 ')).toBe('#1F2937')
    expect(normalizeHex('1f2937')).toBe('#1F2937')
  })

  it('rejects incomplete or non-hex values', () => {
    expect(isHexColor('#12')).toBe(false)
    expect(normalizeHex('navy')).toBeNull()
  })

  it('uses clearly light or dark ink for every program bar tone', () => {
    expect(getReadableInk('#101318')).toBe('#E8E8E8')
    expect(getReadableInk('#808080')).toBe('#1D1D1D')
    expect(getReadableInk('#F5F6F7')).toBe('#1D1D1D')
  })
})
