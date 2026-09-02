import { describe, expect, it } from 'vitest'
import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
  it('formats storage values at useful scales', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1_024)).toBe('1 KB')
    expect(formatBytes(1_572_864)).toBe('1.5 MB')
    expect(formatBytes(10 * 1_024 ** 3)).toBe('10 GB')
  })
})
