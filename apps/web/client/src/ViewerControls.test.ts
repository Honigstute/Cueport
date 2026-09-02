import { describe, expect, it } from 'vitest'
import type { SlideAsset } from '../../../../src/renderer/src/types'
import { viewerThumbnailPolicy, viewerThumbnailUrl } from './ViewerControls'

function slide(overrides: Partial<SlideAsset> = {}): SlideAsset {
  return {
    id: 'slide-1',
    name: 'Homepage.png',
    url: '/api/assets/original',
    thumbnailUrl: '/api/assets/poster',
    width: 1920,
    height: 1080,
    mimeType: 'image/png',
    origin: 'local',
    sourceKey: 'slides/slide-1.png',
    ...overrides
  }
}

describe('viewer thumbnails', () => {
  it('prefers a poster and bounds the legacy-original fallback to warmed stills', () => {
    expect(viewerThumbnailUrl(slide(), 4, 0)).toBe('/api/assets/poster')
    expect(viewerThumbnailUrl(slide({ thumbnailUrl: '' }), 4, 4)).toBe('/api/assets/original')
    expect(viewerThumbnailUrl(slide({ thumbnailUrl: '' }), 5, 4)).toBe('/api/assets/original')
    expect(viewerThumbnailUrl(slide({ thumbnailUrl: '' }), 6, 4)).toBeNull()
    expect(viewerThumbnailUrl(slide({ thumbnailUrl: '', mimeType: 'video/mp4' }), 4, 4)).toBeNull()
  })

  it('loads only the active screen and immediate neighbors eagerly', () => {
    expect(viewerThumbnailPolicy(4, 4)).toEqual({ loading: 'eager', fetchPriority: 'high' })
    expect(viewerThumbnailPolicy(3, 4)).toEqual({ loading: 'eager', fetchPriority: 'low' })
    expect(viewerThumbnailPolicy(5, 4)).toEqual({ loading: 'eager', fetchPriority: 'low' })
    expect(viewerThumbnailPolicy(8, 4)).toEqual({ loading: 'lazy', fetchPriority: 'low' })
  })
})
