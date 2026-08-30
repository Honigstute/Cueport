import { describe, expect, it } from 'vitest'
import { commentAnchorFromClientPoint, moveCommentAnchor } from './commentAnchors'

describe('comment artwork anchors', () => {
  it('maps the same visual source point at different rendered scales', () => {
    expect(commentAnchorFromClientPoint(250, 475, { left: 100, top: 100, width: 600, height: 500 })).toEqual({ x: 0.25, y: 0.75 })
    expect(commentAnchorFromClientPoint(175, 287.5, { left: 100, top: 100, width: 300, height: 250 })).toEqual({ x: 0.25, y: 0.75 })
  })

  it('accounts for viewport scrolling through the live artwork rectangle', () => {
    expect(commentAnchorFromClientPoint(300, 250, { left: 100, top: -250, width: 400, height: 1000 })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('clamps edge clicks and rejects unmeasurable surfaces', () => {
    expect(commentAnchorFromClientPoint(-20, 800, { left: 0, top: 0, width: 500, height: 500 })).toEqual({ x: 0, y: 1 })
    expect(commentAnchorFromClientPoint(0, 0, { left: 0, top: 0, width: 0, height: 500 })).toBeNull()
  })

  it('moves a saved point by the same visual distance at the current artwork scale', () => {
    expect(moveCommentAnchor({ x: 0.25, y: 0.5 }, 100, -50, { width: 400, height: 200 })).toEqual({ x: 0.5, y: 0.25 })
    expect(moveCommentAnchor({ x: 0.9, y: 0.1 }, 200, -100, { width: 400, height: 200 })).toEqual({ x: 1, y: 0 })
    expect(moveCommentAnchor({ x: 0.5, y: 0.5 }, 10, 10, { width: 0, height: 200 })).toBeNull()
  })
})
