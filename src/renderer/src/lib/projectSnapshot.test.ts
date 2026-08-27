import { describe, expect, it } from 'vitest'
import { createInitialState, parseStoredSettings, presentationReducer } from '../state/presentationReducer'
import type { SlideAsset } from '../types'
import { createProjectChangeSnapshot, snapshotPresentationState } from './projectSnapshot'

function slide(id: string): SlideAsset {
  return {
    id,
    name: `${id}.png`,
    url: `blob:${id}`,
    thumbnailUrl: `blob:${id}-thumbnail`,
    width: 1920,
    height: 1080,
    mimeType: 'image/png',
    origin: 'local',
    sourceKey: `source-${id}`
  }
}

describe('project change snapshots', () => {
  it('matches a freshly opened saved presentation before any edits', () => {
    const slides = [slide('one'), slide('two')]
    const settings = parseStoredSettings(JSON.stringify({
      mode: 'canvas',
      background: '#123456'
    }))
    const saved = createProjectChangeSnapshot({
      settings,
      slides,
      references: [],
      logoName: null,
      logoSourceKey: null
    })
    const restored = presentationReducer(createInitialState(), {
      type: 'RESTORE_PRESENTATION',
      slides,
      references: [],
      activeId: 'two',
      settings,
      logo: null
    })

    expect(snapshotPresentationState(restored)).toBe(saved)
  })

  it('ignores slide navigation and interface visibility', () => {
    let state = presentationReducer(createInitialState(), {
      type: 'ADD_SLIDES',
      slides: [slide('one'), slide('two')]
    })
    const saved = snapshotPresentationState(state)

    state = presentationReducer(state, { type: 'SELECT_SLIDE', id: 'two' })
    state = presentationReducer(state, { type: 'SET_CHROME_MODE', mode: 'hidden' })

    expect(snapshotPresentationState(state)).toBe(saved)
  })

  it('detects changes to presentation content and styling', () => {
    let state = presentationReducer(createInitialState(), {
      type: 'ADD_SLIDES',
      slides: [slide('one')]
    })
    const saved = snapshotPresentationState(state)

    state = presentationReducer(state, { type: 'RENAME_SLIDE', id: 'one', name: 'Homepage.png' })
    expect(snapshotPresentationState(state)).not.toBe(saved)

    const renamed = snapshotPresentationState(state)
    state = presentationReducer(state, { type: 'SET_BACKGROUND', background: '#123456' })
    expect(snapshotPresentationState(state)).not.toBe(renamed)
  })
})
