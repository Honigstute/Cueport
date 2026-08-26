import { describe, expect, it } from 'vitest'
import { moveItem } from './deck'

describe('moveItem', () => {
  it('moves an item while preserving the rest of the deck', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('returns a safe copy for an invalid move', () => {
    const original = ['a', 'b']
    const result = moveItem(original, -1, 1)
    expect(result).toEqual(original)
    expect(result).not.toBe(original)
  })
})
