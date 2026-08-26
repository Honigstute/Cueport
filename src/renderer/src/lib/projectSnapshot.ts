import { toStoredSettings } from '../state/presentationReducer'
import type { PresentationState, ReferenceAsset, SlideAsset, StoredSettings } from '../types'

export interface ProjectSnapshotSource {
  settings: StoredSettings
  slides: Array<Pick<SlideAsset, 'id' | 'name' | 'width' | 'height' | 'sourceKey'>>
  references: Array<Pick<ReferenceAsset, 'id' | 'name' | 'width' | 'height' | 'sourceKey'>>
  logoName: string | null
  logoSourceKey: string | null
}

/**
 * Captures only data that saving can meaningfully preserve. The active slide,
 * zoom, temporary reference overlays, and interface visibility are viewing
 * state; changing them must never trigger an unsaved-changes prompt.
 */
export function createProjectChangeSnapshot(source: ProjectSnapshotSource): string {
  return JSON.stringify({
    settings: source.settings,
    slides: source.slides.map(({ id, name, width, height, sourceKey }) => ({ id, name, width, height, sourceKey })),
    references: source.references.map(({ id, name, width, height, sourceKey }) => ({ id, name, width, height, sourceKey })),
    brand: { logoName: source.logoName, logoSourceKey: source.logoSourceKey }
  })
}

export function snapshotPresentationState(state: PresentationState): string {
  return createProjectChangeSnapshot({
    settings: toStoredSettings(state),
    slides: state.slides,
    references: state.references,
    logoName: state.brand.logoName,
    logoSourceKey: state.brand.logoSourceKey
  })
}
