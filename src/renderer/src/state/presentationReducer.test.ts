import { describe, expect, it } from 'vitest'
import type { SlideAsset } from '../types'
import { DEFAULT_CANVAS_BACKGROUND, createInitialState, parseStoredSettings, presentationReducer, toStoredSettings } from './presentationReducer'

function slide(id: string): SlideAsset {
  return {
    id,
    name: `${id}.jpg`,
    url: `blob:${id}`,
    thumbnailUrl: `blob:${id}-thumbnail`,
    width: 1440,
    height: 2400,
    mimeType: 'image/jpeg',
    origin: 'local',
    sourceKey: null
  }
}

describe('presentationReducer', () => {
  it('selects the nearest frame after removing the active one', () => {
    let state = createInitialState()
    state = presentationReducer(state, { type: 'ADD_SLIDES', slides: [slide('a'), slide('b'), slide('c')] })
    state = presentationReducer(state, { type: 'SELECT_SLIDE', id: 'b' })
    state = presentationReducer(state, { type: 'REMOVE_SLIDE', id: 'b' })

    expect(state.slides.map((item) => item.id)).toEqual(['a', 'c'])
    expect(state.activeId).toBe('c')
  })

  it('renames one sequence frame without touching its imported asset data', () => {
    let state = createInitialState()
    state = presentationReducer(state, { type: 'ADD_SLIDES', slides: [slide('a'), slide('b')] })
    state = presentationReducer(state, { type: 'RENAME_SLIDE', id: 'b', name: 'Homepage final.jpg' })

    expect(state.slides.map((item) => item.name)).toEqual(['a.jpg', 'Homepage final.jpg'])
    expect(state.slides[1].url).toBe('blob:b')
  })

  it('keeps reference images ordered separately from the presentation sequence', () => {
    let state = createInitialState()
    state = presentationReducer(state, { type: 'ADD_SLIDES', slides: [slide('frame')] })
    state = presentationReducer(state, { type: 'ADD_REFERENCES', references: [slide('ref-a'), slide('ref-b')] })
    state = presentationReducer(state, { type: 'MOVE_REFERENCE', fromIndex: 1, toIndex: 0 })
    state = presentationReducer(state, { type: 'REMOVE_REFERENCE', id: 'ref-a' })

    expect(state.slides.map((item) => item.id)).toEqual(['frame'])
    expect(state.references.map((item) => item.id)).toEqual(['ref-b'])
  })

  it('starts a new presentation without carrying over slides or a client mark', () => {
    let state = createInitialState()
    state = presentationReducer(state, { type: 'ADD_SLIDES', slides: [slide('old')] })
    state = presentationReducer(state, { type: 'ADD_REFERENCES', references: [slide('old-reference')] })
    state = presentationReducer(state, { type: 'SET_BACKGROUND', background: '#101318' })
    state = presentationReducer(state, {
      type: 'SET_LOGO',
      url: 'blob:logo',
      name: 'client.svg',
      sourceKey: 'logo-key'
    })
    state = presentationReducer(state, { type: 'START_PRESENTATION', slides: [slide('new')] })

    expect(state.slides.map((item) => item.id)).toEqual(['new'])
    expect(state.activeId).toBe('new')
    expect(state.references).toEqual([])
    expect(state.background).toBe(DEFAULT_CANVAS_BACKGROUND)
    expect(state.brand).toMatchObject({ logoUrl: null, logoName: null, logoSourceKey: null })
    expect(state.chromeMode).toBe('all')
  })

  it('clamps persisted presentation controls to safe UI bounds', () => {
    const settings = parseStoredSettings(JSON.stringify({
      mode: 'viewport',
      background: '#123456',
      viewport: { label: 'Broken', width: -20, height: 900 },
      brand: { position: 'middle', width: 9000, opacity: -1, margin: 0 }
    }))

    expect(settings.viewport).toEqual({ label: 'Desktop', width: 1920, height: 1080 })
    expect(settings.brand).toEqual({ position: 'top-right', width: 240, opacity: 0.2, margin: 8, showOnCanvas: true })
    expect(settings.mode).toBe('canvas')
    expect(settings.viewportEnabled).toBe(true)
  })

  it('migrates former zoom modes into the unified canvas', () => {
    const settings = parseStoredSettings(JSON.stringify({ mode: 'zoom' }))

    expect(settings.mode).toBe('canvas')
    expect(settings.viewportEnabled).toBe(false)
  })

  it('migrates the former desktop viewport to full HD', () => {
    const settings = parseStoredSettings(JSON.stringify({
      viewport: { label: 'Desktop', width: 1440, height: 900 }
    }))

    expect(settings.viewport).toEqual({ label: 'Desktop', width: 1920, height: 1080 })
  })

  it('uses one canvas state while moving through every overlay chrome mode', () => {
    const initial = presentationReducer(createInitialState(), { type: 'SET_MODE', mode: 'canvas' })
    const transitions = ['all', 'sequence', 'settings', 'top', 'hidden'] as const

    let state = initial
    for (const mode of transitions) {
      state = presentationReducer(state, { type: 'SET_HELP_OPEN', value: true })
      state = presentationReducer(state, { type: 'SET_CHROME_MODE', mode })

      expect(state.chromeMode).toBe(mode)
      expect(state.isHelpOpen).toBe(false)
      expect(state.mode).toBe('canvas')
      expect(state.slides).toBe(initial.slides)
    }
  })

  it('treats viewport as a canvas option instead of a separate display mode', () => {
    let state = createInitialState()
    state = presentationReducer(state, { type: 'SET_VIEWPORT_ENABLED', value: true })

    expect(state.mode).toBe('canvas')
    expect(state.viewportEnabled).toBe(true)

    state = presentationReducer(state, { type: 'SET_MODE', mode: 'fit-width' })
    expect(state.viewportEnabled).toBe(false)
  })

  it('persists canvas presentation options with safe fallbacks', () => {
    const settings = parseStoredSettings(JSON.stringify({
      canvasStartAtTop: true,
      canvasRoundedCorners: false,
      canvasImageGlow: true,
      referenceImageShadow: true,
      canvasFrame: 'phone',
      programBarColor: '#445566',
      phoneBrowserBars: {
        enabled: true,
        color: '#112233'
      },
      background: '#123456',
      viewport: { label: 'Desktop', width: 1920, height: 1080 },
      viewportMarker: 900,
      brand: { showOnCanvas: false }
    }))

    expect(settings.canvasStartAtTop).toBe(true)
    expect(settings.canvasRoundedCorners).toBe(false)
    expect(settings.canvasImageGlow).toBe(true)
    expect(settings.referenceImageShadow).toBe(true)
    expect(settings.canvasFrame).toBe('phone')
    expect(settings.programBarColor).toBe('#445566')
    expect(settings.phoneBrowserBars).toEqual({
      enabled: true,
      color: '#112233'
    })
    expect(settings.background).toBe('#123456')
    expect(settings.viewportMarker).toBe(900)
    expect(settings.brand.showOnCanvas).toBe(false)

    const invalidSettings = parseStoredSettings(JSON.stringify({
      canvasFrame: 'browser',
      programBarColor: 'gray',
      phoneBrowserBars: { enabled: 'yes', color: 'gray', bottomColor: '#010203' }
    }))
    expect(invalidSettings.canvasFrame).toBe('none')
    expect(invalidSettings.canvasRoundedCorners).toBe(true)
    expect(invalidSettings.canvasImageGlow).toBe(false)
    expect(invalidSettings.referenceImageShadow).toBe(false)
    expect(invalidSettings.programBarColor).toBe('#D9DCE0')
    expect(invalidSettings.phoneBrowserBars).toEqual({
      enabled: false,
      color: '#010203'
    })
    expect(invalidSettings.viewportMarker).toBeNull()
  })

  it('clears a crop marker that no longer fits a changed viewport', () => {
    let state = createInitialState(parseStoredSettings(JSON.stringify({ viewportMarker: 900 })))
    state = presentationReducer(state, { type: 'SET_VIEWPORT_MARKER', marker: 840 })
    expect(state.viewportMarker).toBe(840)

    state = presentationReducer(state, {
      type: 'SET_VIEWPORT',
      viewport: { label: 'Mobile', width: 390, height: 844 }
    })
    expect(state.viewportMarker).toBe(840)

    state = presentationReducer(state, {
      type: 'SET_VIEWPORT',
      viewport: { label: 'Short', width: 390, height: 800 }
    })
    expect(state.viewportMarker).toBeNull()
  })

  it('serializes every appearance color, the marker, and logo visibility', () => {
    const state = createInitialState(parseStoredSettings(JSON.stringify({
      background: '#112233',
      canvasImageGlow: true,
      referenceImageShadow: true,
      programBarColor: '#445566',
      phoneBrowserBars: { enabled: true, color: '#778899' },
      viewportMarker: 900,
      brand: { showOnCanvas: false }
    })))

    expect(toStoredSettings(state)).toMatchObject({
      background: '#112233',
      canvasImageGlow: true,
      referenceImageShadow: true,
      programBarColor: '#445566',
      phoneBrowserBars: { enabled: true, color: '#778899' },
      viewportMarker: 900,
      brand: { showOnCanvas: false }
    })
  })

  it('persists sequence title display preferences without changing older settings', () => {
    const settings = parseStoredSettings(JSON.stringify({
      sequenceTitles: { hideExtension: true, preferEnding: true }
    }))

    expect(settings.sequenceTitles).toEqual({ hideExtension: true, preferEnding: true })

    const legacySettings = parseStoredSettings(JSON.stringify({ mode: 'fit-width' }))
    expect(legacySettings.sequenceTitles).toEqual({ hideExtension: false, preferEnding: false })

    let state = createInitialState(settings)
    state = presentationReducer(state, {
      type: 'PATCH_SEQUENCE_TITLES',
      patch: { preferEnding: false }
    })
    expect(state.sequenceTitles).toEqual({ hideExtension: true, preferEnding: false })
  })

  it('restores a saved presentation as one complete editor state', () => {
    const settings = parseStoredSettings(JSON.stringify({
      mode: 'canvas',
      viewportEnabled: true,
      background: '#123456'
    }))
    const restoredSlide = slide('a')
    const state = presentationReducer(createInitialState(), {
      type: 'RESTORE_PRESENTATION',
      slides: [restoredSlide],
      references: [slide('reference')],
      activeId: restoredSlide.id,
      settings,
      logo: { name: 'client.svg', url: 'cueport-asset://local/logo', sourceKey: 'logo-key' }
    })

    expect(state.slides).toEqual([restoredSlide])
    expect(state.references.map((item) => item.id)).toEqual(['reference'])
    expect(state.activeId).toBe('a')
    expect(state.mode).toBe('canvas')
    expect(state.viewportEnabled).toBe(true)
    expect(state.background).toBe('#123456')
    expect(state.brand).toMatchObject({ logoName: 'client.svg', logoUrl: 'cueport-asset://local/logo', logoSourceKey: 'logo-key' })
    expect(state.chromeMode).toBe('all')
  })
})
