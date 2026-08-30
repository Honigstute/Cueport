import { describe, expect, it } from 'vitest'
import { commentAnchorFromClientPoint } from './commentAnchors'

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
})
