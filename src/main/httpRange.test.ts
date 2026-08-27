import { describe, expect, it } from 'vitest'
import { resolveByteRange } from './httpRange'

describe('resolveByteRange', () => {
  it('leaves normal asset requests unbounded', () => {
    expect(resolveByteRange(null, 1000)).toBeUndefined()
  })

  it('supports bounded, open-ended, and suffix video ranges', () => {
    expect(resolveByteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199, length: 100 })
    expect(resolveByteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999, length: 100 })
    expect(resolveByteRange('bytes=-250', 1000)).toEqual({ start: 750, end: 999, length: 250 })
  })

  it('clamps ends and rejects invalid or multiple ranges', () => {
    expect(resolveByteRange('bytes=900-1200', 1000)).toEqual({ start: 900, end: 999, length: 100 })
    expect(resolveByteRange('bytes=1000-', 1000)).toBeNull()
    expect(resolveByteRange('bytes=0-20,40-60', 1000)).toBeNull()
  })
})
