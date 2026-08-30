import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationDocument } from '../../../src/shared/presentation'
import { PUBLICATION_PREVIEW_ASSET_KEY } from '../../../src/shared/projects'
import { collectExpectedAssets, normalizePresentationName, preferredDashboardThumbnailKeys } from './presentationAssets'

const document: PresentationDocument = {
  schemaVersion: 1,
  id: '26f80ac8-952f-40f5-b7d0-04e708cc35fa',
  name: 'Example',
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-08-30T11:00:00.000Z',
  activeSlideId: 'b6d45b17-cf03-46ed-b901-cbb334942232',
  settings: DEFAULT_PRESENTATION_SETTINGS,
  slides: [{
    id: 'b6d45b17-cf03-46ed-b901-cbb334942232',
    name: 'Home.png',
    width: 1920,
    height: 1080,
    assetKey: 'slides/home.png',
    mimeType: 'image/png'
  }],
  references: [],
  brand: null
}

describe('publication assets', () => {
  it('derives the exact upload set from the document', () => {
    expect(collectExpectedAssets(document)).toEqual([{ key: 'slides/home.png', mimeType: 'image/png' }])
  })

  it('rejects duplicate keys before any upload starts', () => {
    expect(() => collectExpectedAssets({ ...document, references: [document.slides[0]] })).toThrow(/reuses an asset key/i)
  })

  it('accepts one reserved JPEG desktop preview when publishing it', () => {
    expect(collectExpectedAssets(document, true)).toEqual([
      { key: 'slides/home.png', mimeType: 'image/png' },
      { key: PUBLICATION_PREVIEW_ASSET_KEY, mimeType: 'image/jpeg' }
    ])
  })

  it('prefers the exact desktop preview before falling back to the first screen', () => {
    expect(preferredDashboardThumbnailKeys(document)).toEqual([
      PUBLICATION_PREVIEW_ASSET_KEY,
      'slides/home.png'
    ])
  })

  it('normalizes safe web presentation names and rejects invalid ones', () => {
    expect(normalizePresentationName('  Client   review  ')).toBe('Client review')
    expect(() => normalizePresentationName('')).toThrow(/shorter than 120/i)
    expect(() => normalizePresentationName('Invalid\u0000name')).toThrow(/shorter than 120/i)
  })
})
