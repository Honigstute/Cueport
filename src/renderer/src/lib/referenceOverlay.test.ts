import { describe, expect, it } from 'vitest'
import {
  createReferenceOverlayRect,
  moveReferenceOverlayRect,
  resizeReferenceOverlayRect
} from './referenceOverlay'

describe('reference overlay geometry', () => {
  it('places a new overlay near the requested point and inside the stage', () => {
    const rect = createReferenceOverlayRect(1200, 800, 1600, 900, 1100, 740)

    expect(rect.x + rect.width).toBeLessThanOrEqual(1184)
    expect(rect.y + rect.height).toBeLessThanOrEqual(784)
    expect(rect.width / rect.height).toBeCloseTo(16 / 9)
  })

  it('clamps a moved overlay to the visible stage', () => {
    const rect = moveReferenceOverlayRect(
      { x: 200, y: 200, width: 320, height: 180 },
      -1000,
      1000,
      1000,
      700
    )

    expect(rect.x).toBe(16)
    expect(rect.y).toBe(504)
  })

  it('keeps the opposite resize corner fixed while preserving aspect ratio', () => {
    const original = { x: 200, y: 150, width: 320, height: 180 }
    const resized = resizeReferenceOverlayRect(original, 'north-west', -80, -45, 1000, 700)

    expect(resized.x + resized.width).toBeCloseTo(original.x + original.width)
    expect(resized.y + resized.height).toBeCloseTo(original.y + original.height)
    expect(resized.width / resized.height).toBeCloseTo(original.width / original.height)
  })
})
