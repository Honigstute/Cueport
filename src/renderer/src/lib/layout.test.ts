import { describe, expect, it } from 'vitest'
import { calculateContainScale, shouldUseEdgeToEdgeCanvas } from './layout'

describe('calculateContainScale', () => {
  it('upscales a viewport to use a larger presentation area', () => {
    expect(calculateContainScale(3779, 2056, 1440, 900)).toBeCloseTo(2056 / 900)
  })

  it('shrinks a tall design until the complete image fits', () => {
    expect(calculateContainScale(3779, 2056, 1920, 4146)).toBeCloseTo(2056 / 4146)
  })

  it('returns zero until every measured dimension is usable', () => {
    expect(calculateContainScale(0, 2056, 1440, 900)).toBe(0)
    expect(calculateContainScale(3779, Number.NaN, 1440, 900)).toBe(0)
  })
})

describe('shouldUseEdgeToEdgeCanvas', () => {
  it('removes canvas gutters when the scaled image reaches the viewing width', () => {
    expect(shouldUseEdgeToEdgeCanvas(3840, 3840)).toBe(true)
    expect(shouldUseEdgeToEdgeCanvas(3840, 4200)).toBe(true)
  })

  it('keeps canvas gutters around smaller images', () => {
    expect(shouldUseEdgeToEdgeCanvas(3840, 3839)).toBe(false)
  })

  it('rejects invalid measurements', () => {
    expect(shouldUseEdgeToEdgeCanvas(0, 3840)).toBe(false)
    expect(shouldUseEdgeToEdgeCanvas(3840, Number.NaN)).toBe(false)
  })
})
