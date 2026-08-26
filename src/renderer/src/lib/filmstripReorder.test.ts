import { describe, expect, it } from 'vitest'
import { resolveFilmstripDestination, resolveFilmstripPreviewShift } from './filmstripReorder'

describe('filmstrip reorder preview', () => {
  it('resolves before and after positions after removing the source card', () => {
    expect(resolveFilmstripDestination(0, 2, 'before', 4)).toBe(1)
    expect(resolveFilmstripDestination(0, 2, 'after', 4)).toBe(2)
    expect(resolveFilmstripDestination(3, 1, 'before', 4)).toBe(1)
    expect(resolveFilmstripDestination(3, 1, 'after', 4)).toBe(2)
  })

  it('moves only the cards between the source and destination', () => {
    expect([0, 1, 2, 3].map((index) => resolveFilmstripPreviewShift(index, 0, 2, 170)))
      .toEqual([0, -170, -170, 0])
    expect([0, 1, 2, 3].map((index) => resolveFilmstripPreviewShift(index, 3, 1, 170)))
      .toEqual([0, 170, 170, 0])
  })
})
