import { describe, expect, it } from 'vitest'
import { isSupportedImageName, isSupportedMediaName, isSupportedVideoName } from './assets'

describe('presentation media support', () => {
  it('accepts MP4 through the shared sequence and References media pipeline', () => {
    expect(isSupportedMediaName('walkthrough.MP4')).toBe(true)
    expect(isSupportedVideoName('walkthrough.MP4')).toBe(true)
    expect(isSupportedImageName('walkthrough.MP4')).toBe(false)
  })

  it('keeps unsupported containers out of the import pipeline', () => {
    expect(isSupportedMediaName('walkthrough.mov')).toBe(false)
    expect(isSupportedMediaName('walkthrough.webm')).toBe(false)
  })
})
