import { describe, expect, it } from 'vitest'
import type { SlideAsset } from '../types'
import { adjacentMediaPreloadUrls } from './mediaPreload'

function slide(id: string, mimeType: SlideAsset['mimeType'] = 'image/jpeg'): SlideAsset {
  return {
    id,
    name: `${id}.jpg`,
    url: `/assets/${id}`,
    thumbnailUrl: `/posters/${id}`,
    width: 1920,
    height: 1080,
    mimeType,
    origin: 'local',
    sourceKey: null
  }
}

describe('adjacent media preloading', () => {
  it('preloads the current image and its immediate neighbors only', () => {
    const slides = ['one', 'two', 'three', 'four'].map((id) => slide(id))
    expect(adjacentMediaPreloadUrls(slides, 2)).toEqual([
      '/assets/three',
      '/assets/two',
      '/assets/four'
    ])
  })

  it('preloads a poster rather than a complete video', () => {
    expect(adjacentMediaPreloadUrls([slide('video', 'video/mp4')], 0)).toEqual(['/posters/video'])
  })

  it('returns no targets without an active slide', () => {
    expect(adjacentMediaPreloadUrls([slide('one')], -1)).toEqual([])
  })
})
