import { describe, expect, it } from 'vitest'
import { formatZoom, nextZoomStop, zoomDirectionFromWheel } from './zoom'

describe('free zoom', () => {
  it('moves through fixed zoom stops in both directions', () => {
    expect(nextZoomStop(0.1, 1)).toBe(0.15)
    expect(nextZoomStop(0.2, -1)).toBe(0.15)
    expect(nextZoomStop(1, 1)).toBe(1.25)
    expect(nextZoomStop(1.5, 1)).toBe(1.75)
    expect(nextZoomStop(1.75, -1)).toBe(1.5)
  })

  it('clamps at the minimum and maximum stops', () => {
    expect(nextZoomStop(0.1, -1)).toBe(0.1)
    expect(nextZoomStop(4, 1)).toBe(4)
  })

  it('formats zoom as a stable percentage', () => {
    expect(formatZoom(0.15)).toBe('15%')
    expect(formatZoom(1.25)).toBe('125%')
    expect(formatZoom(1.75)).toBe('175%')
  })

  it('responds to even the smallest non-zero wheel delta', () => {
    expect(zoomDirectionFromWheel(-1)).toBe(1)
    expect(zoomDirectionFromWheel(1)).toBe(-1)
    expect(zoomDirectionFromWheel(0, -1)).toBe(1)
    expect(zoomDirectionFromWheel(0, 1)).toBe(-1)
    expect(zoomDirectionFromWheel(0)).toBeNull()
  })
})
