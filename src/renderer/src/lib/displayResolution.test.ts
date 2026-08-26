import { describe, expect, it } from 'vitest'
import { calculateDisplayResolution } from './displayResolution'

const base = {
  sourceWidth: 1920,
  sourceHeight: 1080,
  viewport: { label: 'Mobile', width: 390, height: 844 }
}

describe('calculateDisplayResolution', () => {
  it('tracks canvas zoom', () => {
    expect(calculateDisplayResolution({
      ...base,
      mode: 'canvas',
      zoom: 1.75,
      viewportEnabled: false,
      fitWidth: null
    })).toEqual({ width: 3360, height: 1890 })
  })

  it('reports the actual fitted image size in fit-width mode', () => {
    expect(calculateDisplayResolution({
      ...base,
      mode: 'fit-width',
      zoom: 1,
      viewportEnabled: false,
      fitWidth: 960
    })).toEqual({ width: 960, height: 540 })
  })

  it('tracks the displayed viewport dimensions at the active zoom', () => {
    expect(calculateDisplayResolution({
      ...base,
      mode: 'canvas',
      zoom: 2,
      viewportEnabled: true,
      fitWidth: null
    })).toEqual({ width: 780, height: 1688 })
  })
})
