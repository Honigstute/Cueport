import { describe, expect, it } from 'vitest'
import type { SlideAsset } from '../../../../src/renderer/src/types'
import {
  shouldGenerateLegacyViewerThumbnail,
  viewerThumbnailPolicy,
  viewerThumbnailUrl
} from './ViewerControls'

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
  it('prefers a persisted poster', () => {
    expect(viewerThumbnailUrl(slide())).toBe('/api/assets/poster')
    expect(viewerThumbnailUrl(slide({ thumbnailUrl: '' }))).toBeNull()
  })

  it('generates legacy previews only for warmed stills', () => {
    const legacy = slide({ thumbnailUrl: '' })
    expect(shouldGenerateLegacyViewerThumbnail(legacy, 4, 4)).toBe(true)
    expect(shouldGenerateLegacyViewerThumbnail(legacy, 5, 4)).toBe(true)
    expect(shouldGenerateLegacyViewerThumbnail(legacy, 6, 4)).toBe(false)
    expect(shouldGenerateLegacyViewerThumbnail(slide({ thumbnailUrl: '', mimeType: 'video/mp4' }), 4, 4)).toBe(false)
  })

  it('loads only the active screen and immediate neighbors eagerly', () => {
    expect(viewerThumbnailPolicy(4, 4)).toEqual({ loading: 'eager', fetchPriority: 'high' })
    expect(viewerThumbnailPolicy(3, 4)).toEqual({ loading: 'eager', fetchPriority: 'low' })
    expect(viewerThumbnailPolicy(5, 4)).toEqual({ loading: 'eager', fetchPriority: 'low' })
    expect(viewerThumbnailPolicy(8, 4)).toEqual({ loading: 'lazy', fetchPriority: 'low' })
  })
})
