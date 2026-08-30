import { describe, expect, it } from 'vitest'
import { splitCommentLinks } from './commentLinks'

describe('comment links', () => {
  it('turns only HTTP links into safe link segments', () => {
    expect(splitCommentLinks('See https://example.com/test, then javascript:alert(1).')).toEqual([
      { text: 'See ' },
      { text: 'https://example.com/test', url: 'https://example.com/test' },
      { text: ',' },
      { text: ' then javascript:alert(1).' }
    ])
  })
})
