import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationDocument } from '../../../../src/shared/presentation'
import { PUBLICATION_PREVIEW_ASSET_KEY } from '../../../../src/shared/projects'
import { createInitialState } from '../../../../src/renderer/src/state/presentationReducer'
import { documentFromEditorState, requiredEditorAssets } from './webEditorPublication'

const original: PresentationDocument = {
  schemaVersion: 1,
  id: '6a4db9b8-fb92-4f04-aa5a-4af70be67a58',
  name: 'Web deck',
  createdAt: '2026-09-02T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
  activeSlideId: '4530e751-d6e9-4d0a-98e4-acde98863762',
  settings: DEFAULT_PRESENTATION_SETTINGS,
  slides: [],
  references: [],
  brand: null
}

describe('web editor publication', () => {
  it('serializes the shared renderer state without browser URLs', () => {
    const state = {
      ...createInitialState(),
      activeId: '4530e751-d6e9-4d0a-98e4-acde98863762',
      slides: [{
        id: '4530e751-d6e9-4d0a-98e4-acde98863762',
        name: 'Motion.mp4',
        width: 1920,
        height: 1080,
        mimeType: 'video/mp4' as const,
        origin: 'local' as const,
        sourceKey: 'slides/motion.mp4',
        url: 'blob:local-preview',
        thumbnailUrl: 'data:image/jpeg;base64,preview'
      }]
    }
    const document = documentFromEditorState(
      state,
      original,
      new Map([[state.slides[0].id, 'thumbnails/motion.jpg']])
    )

    expect(document.slides[0]).toMatchObject({
      assetKey: 'slides/motion.mp4',
      posterKey: 'thumbnails/motion.jpg'
    })
    expect(JSON.stringify(document)).not.toContain('blob:')
  })

  it('preserves the dashboard preview only when requested', () => {
    const document = {
      ...original,
      slides: [{
        id: original.activeSlideId,
        name: 'Layout.jpg',
        width: 1920,
        height: 1080,
        assetKey: 'slides/layout.jpg',
        mimeType: 'image/jpeg' as const
      }]
    }
    expect(requiredEditorAssets(document, false).map((asset) => asset.key)).toEqual(['slides/layout.jpg'])
    expect(requiredEditorAssets(document, true).map((asset) => asset.key)).toEqual([
      'slides/layout.jpg',
      PUBLICATION_PREVIEW_ASSET_KEY
    ])
  })
})
