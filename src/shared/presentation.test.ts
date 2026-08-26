import { describe, expect, it } from 'vitest'
import {
  PRESENTATION_DOCUMENT_VERSION,
  parseDesktopPresentationFile,
  parsePresentationDocument,
  sanitizePresentationSettings,
  validateAssetKey,
  type PresentationDocument
} from './presentation'

const PRESENTATION_ID = '11111111-1111-4111-8111-111111111111'
const SLIDE_ID = '22222222-2222-4222-8222-222222222222'
const REFERENCE_ID = '33333333-3333-4333-8333-333333333333'

function documentFixture(): PresentationDocument {
  return {
    schemaVersion: PRESENTATION_DOCUMENT_VERSION,
    id: PRESENTATION_ID,
    name: 'Website review',
    createdAt: '2026-08-26T10:00:00.000Z',
    updatedAt: '2026-08-26T11:00:00.000Z',
    activeSlideId: SLIDE_ID,
    settings: sanitizePresentationSettings({
      mode: 'canvas',
      viewport: { label: 'Desktop', width: 1920, height: 1080 }
    }),
    slides: [{
      id: SLIDE_ID,
      name: 'Homepage.png',
      width: 1920,
      height: 1080,
      assetKey: `assets/${SLIDE_ID}.png`,
      mimeType: 'image/png'
    }],
    references: [{
      id: REFERENCE_ID,
      name: 'Style guide.webp',
      width: 1200,
      height: 1800,
      assetKey: `references/${REFERENCE_ID}.webp`,
      mimeType: 'image/webp'
    }],
    brand: {
      name: 'Client.svg',
      assetKey: 'assets/logo.svg',
      mimeType: 'image/svg+xml'
    }
  }
}

describe('portable presentation documents', () => {
  it('round-trips a document without desktop paths or source keys', () => {
    const parsed = parsePresentationDocument(documentFixture())

    expect(parsed).toEqual(documentFixture())
    expect(JSON.stringify(parsed)).not.toContain('sourceKey')
    expect(JSON.stringify(parsed)).not.toContain('/Users/')
  })

  it('rejects path traversal, absolute paths, and duplicate asset identifiers', () => {
    expect(() => validateAssetKey('../private/image.png')).toThrow(/unsafe key/i)
    expect(() => validateAssetKey('/private/image.png')).toThrow(/invalid key/i)
    expect(() => validateAssetKey('assets\\image.png')).toThrow(/invalid key/i)

    const duplicate = documentFixture()
    duplicate.references[0].id = duplicate.slides[0].id
    expect(() => parsePresentationDocument(duplicate)).toThrow(/duplicate image identifiers/i)
  })

  it('migrates the original desktop file into the portable document', () => {
    const migrated = parseDesktopPresentationFile({
      version: 1,
      id: PRESENTATION_ID,
      name: 'Legacy presentation',
      createdAt: '2026-08-25T10:00:00.000Z',
      updatedAt: '2026-08-25T11:00:00.000Z',
      activeSlideId: SLIDE_ID,
      settings: {
        mode: 'viewport',
        phoneBrowserBars: { enabled: true, topColor: '#123456' }
      },
      slides: [{
        id: SLIDE_ID,
        name: 'Homepage.png',
        width: 1920,
        height: 1080,
        assetFile: `assets\\${SLIDE_ID}.png`
      }],
      references: [],
      brand: {
        logoName: 'Client.svg',
        assetFile: 'assets\\logo.svg'
      }
    })

    expect(migrated.schemaVersion).toBe(PRESENTATION_DOCUMENT_VERSION)
    expect(migrated.slides[0]).toMatchObject({ assetKey: `assets/${SLIDE_ID}.png`, mimeType: 'image/png' })
    expect(migrated.brand).toEqual({ name: 'Client.svg', assetKey: 'assets/logo.svg', mimeType: 'image/svg+xml' })
    expect(migrated.settings).toMatchObject({
      mode: 'canvas',
      viewportEnabled: true,
      phoneBrowserBars: { enabled: true, color: '#123456' }
    })
  })

  it('sanitizes settings once for desktop and future web readers', () => {
    const settings = sanitizePresentationSettings({
      mode: 'zoom',
      viewport: { label: 'Custom', width: 5000, height: 4000 },
      viewportMarker: 3000,
      background: 'not-a-color',
      brand: { width: 999, opacity: -2, position: 'center' }
    })

    expect(settings.mode).toBe('canvas')
    expect(settings.viewport).toEqual({ label: 'Custom', width: 5000, height: 4000 })
    expect(settings.viewportMarker).toBe(3000)
    expect(settings.background).toBe('#F5F6F7')
    expect(settings.brand).toMatchObject({ width: 240, opacity: 0.2, position: 'top-right' })
  })
})
