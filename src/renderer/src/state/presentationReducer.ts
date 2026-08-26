import {
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_PHONE_BROWSER_BARS,
  DEFAULT_PRESENTATION_SETTINGS,
  DEFAULT_PROGRAM_BAR_COLOR,
  DEFAULT_VIEWPORT,
  sanitizePresentationSettings
} from '../../../shared/presentation'
import { isHexColor } from '../lib/colors'
import { moveItem } from '../lib/deck'
import { CANVAS_FRAMES, type BrandSettings, type CanvasFrame, type ChromeMode, type DisplayMode, type PhoneBrowserBarsSettings, type PresentationState, type ReferenceAsset, type SequenceTitleSettings, type SlideAsset, type StoredSettings, type ViewportSize } from '../types'

export { DEFAULT_CANVAS_BACKGROUND, DEFAULT_PHONE_BROWSER_BARS, DEFAULT_PROGRAM_BAR_COLOR, DEFAULT_VIEWPORT }

const DEFAULT_BRAND: BrandSettings = {
  logoUrl: null,
  logoName: null,
  logoSourceKey: null,
  ...DEFAULT_PRESENTATION_SETTINGS.brand
}

export type PresentationAction =
  | { type: 'ADD_SLIDES'; slides: SlideAsset[] }
  | { type: 'ADD_REFERENCES'; references: ReferenceAsset[] }
  | { type: 'START_PRESENTATION'; slides: SlideAsset[] }
  | { type: 'SELECT_SLIDE'; id: string }
  | { type: 'REMOVE_SLIDE'; id: string }
  | { type: 'RENAME_SLIDE'; id: string; name: string }
  | { type: 'MOVE_SLIDE'; fromIndex: number; toIndex: number }
  | { type: 'REMOVE_REFERENCE'; id: string }
  | { type: 'MOVE_REFERENCE'; fromIndex: number; toIndex: number }
  | { type: 'SET_MODE'; mode: DisplayMode }
  | { type: 'SET_VIEWPORT_ENABLED'; value: boolean }
  | { type: 'SET_CANVAS_START_AT_TOP'; value: boolean }
  | { type: 'SET_CANVAS_ROUNDED_CORNERS'; value: boolean }
  | { type: 'SET_CANVAS_IMAGE_GLOW'; value: boolean }
  | { type: 'SET_REFERENCE_IMAGE_SHADOW'; value: boolean }
  | { type: 'SET_CANVAS_FRAME'; frame: CanvasFrame }
  | { type: 'SET_PROGRAM_BAR_COLOR'; color: string }
  | { type: 'PATCH_PHONE_BROWSER_BARS'; patch: Partial<PhoneBrowserBarsSettings> }
  | { type: 'SET_BACKGROUND'; background: string }
  | { type: 'SET_VIEWPORT'; viewport: ViewportSize }
  | { type: 'SET_VIEWPORT_MARKER'; marker: number | null }
  | { type: 'PATCH_SEQUENCE_TITLES'; patch: Partial<SequenceTitleSettings> }
  | { type: 'SET_LOGO'; url: string; name: string; sourceKey: string | null }
  | { type: 'REMOVE_LOGO' }
  | { type: 'PATCH_BRAND'; patch: Partial<Omit<BrandSettings, 'logoUrl' | 'logoName'>> }
  | { type: 'SET_CHROME_MODE'; mode: ChromeMode }
  | { type: 'SET_HELP_OPEN'; value: boolean }
  | { type: 'RESTORE_PRESENTATION'; slides: SlideAsset[]; references: ReferenceAsset[]; activeId: string | null; settings: StoredSettings; logo: { url: string; name: string; sourceKey: string } | null }

export function parseStoredSettings(raw: string | null): StoredSettings {
  if (!raw) return sanitizePresentationSettings(null)
  try {
    return sanitizePresentationSettings(JSON.parse(raw))
  } catch {
    return sanitizePresentationSettings(null)
  }
}

function isValidViewport(viewport: ViewportSize): boolean {
  return Boolean(
    viewport.label.trim() &&
    Number.isInteger(viewport.width) &&
    Number.isInteger(viewport.height) &&
    viewport.width >= 240 && viewport.width <= 10000 &&
    viewport.height >= 240 && viewport.height <= 10000
  )
}

export function createInitialState(stored: StoredSettings = DEFAULT_PRESENTATION_SETTINGS): PresentationState {
  return {
    slides: [],
    references: [],
    activeId: null,
    mode: stored.mode,
    viewportEnabled: stored.viewportEnabled,
    canvasStartAtTop: stored.canvasStartAtTop,
    canvasRoundedCorners: stored.canvasRoundedCorners,
    canvasImageGlow: stored.canvasImageGlow,
    referenceImageShadow: stored.referenceImageShadow,
    canvasFrame: stored.canvasFrame,
    programBarColor: stored.programBarColor,
    phoneBrowserBars: { ...stored.phoneBrowserBars },
    background: stored.background,
    viewport: stored.viewport,
    viewportMarker: stored.viewportMarker,
    sequenceTitles: stored.sequenceTitles,
    brand: { ...DEFAULT_BRAND, ...stored.brand },
    // A new session has no slides to present, so keep the authoring controls
    // visible until the user deliberately enters the clean presentation view.
    chromeMode: 'all',
    isHelpOpen: false
  }
}

export function toStoredSettings(state: PresentationState): StoredSettings {
  const { logoUrl: _logoUrl, logoName: _logoName, logoSourceKey: _logoSourceKey, ...brand } = state.brand
  return {
    mode: state.mode,
    viewportEnabled: state.viewportEnabled,
    canvasStartAtTop: state.canvasStartAtTop,
    canvasRoundedCorners: state.canvasRoundedCorners,
    canvasImageGlow: state.canvasImageGlow,
    referenceImageShadow: state.referenceImageShadow,
    canvasFrame: state.canvasFrame,
    programBarColor: state.programBarColor,
    phoneBrowserBars: { ...state.phoneBrowserBars },
    background: state.background,
    viewport: state.viewport,
    viewportMarker: state.viewportMarker,
    sequenceTitles: state.sequenceTitles,
    brand
  }
}

export function presentationReducer(state: PresentationState, action: PresentationAction): PresentationState {
  switch (action.type) {
    case 'START_PRESENTATION':
      if (action.slides.length === 0) return state
      return {
        ...state,
        slides: action.slides,
        references: [],
        activeId: action.slides[0].id,
        background: DEFAULT_CANVAS_BACKGROUND,
        brand: { ...state.brand, logoUrl: null, logoName: null, logoSourceKey: null },
        chromeMode: 'all',
        isHelpOpen: false
      }
    case 'ADD_SLIDES':
      if (action.slides.length === 0) return state
      return {
        ...state,
        slides: [...state.slides, ...action.slides],
        activeId: action.slides[0].id
      }
    case 'ADD_REFERENCES':
      return action.references.length > 0
        ? { ...state, references: [...state.references, ...action.references] }
        : state
    case 'SELECT_SLIDE':
      return state.slides.some((slide) => slide.id === action.id) ? { ...state, activeId: action.id } : state
    case 'REMOVE_SLIDE': {
      const removedIndex = state.slides.findIndex((slide) => slide.id === action.id)
      if (removedIndex < 0) return state
      const slides = state.slides.filter((slide) => slide.id !== action.id)
      const activeId = state.activeId === action.id
        ? slides[Math.min(removedIndex, slides.length - 1)]?.id ?? null
        : state.activeId
      return { ...state, slides, activeId }
    }
    case 'RENAME_SLIDE':
      return action.name.trim()
        ? {
            ...state,
            slides: state.slides.map((slide) => (
              slide.id === action.id ? { ...slide, name: action.name } : slide
            ))
          }
        : state
    case 'MOVE_SLIDE':
      return { ...state, slides: moveItem(state.slides, action.fromIndex, action.toIndex) }
    case 'REMOVE_REFERENCE':
      return state.references.some((reference) => reference.id === action.id)
        ? { ...state, references: state.references.filter((reference) => reference.id !== action.id) }
        : state
    case 'MOVE_REFERENCE':
      return { ...state, references: moveItem(state.references, action.fromIndex, action.toIndex) }
    case 'SET_MODE':
      return {
        ...state,
        mode: action.mode,
        viewportEnabled: action.mode === 'fit-width' ? false : state.viewportEnabled
      }
    case 'SET_VIEWPORT_ENABLED':
      return {
        ...state,
        mode: action.value ? 'canvas' : state.mode,
        viewportEnabled: action.value
      }
    case 'SET_CANVAS_START_AT_TOP':
      return { ...state, canvasStartAtTop: action.value }
    case 'SET_CANVAS_ROUNDED_CORNERS':
      return { ...state, canvasRoundedCorners: action.value }
    case 'SET_CANVAS_IMAGE_GLOW':
      return { ...state, canvasImageGlow: action.value }
    case 'SET_REFERENCE_IMAGE_SHADOW':
      return { ...state, referenceImageShadow: action.value }
    case 'SET_CANVAS_FRAME':
      return CANVAS_FRAMES.includes(action.frame) ? { ...state, canvasFrame: action.frame } : state
    case 'SET_PROGRAM_BAR_COLOR':
      return isHexColor(action.color) ? { ...state, programBarColor: action.color } : state
    case 'PATCH_PHONE_BROWSER_BARS':
      return {
        ...state,
        phoneBrowserBars: sanitizePresentationSettings({
          phoneBrowserBars: { ...state.phoneBrowserBars, ...action.patch }
        }).phoneBrowserBars
      }
    case 'SET_BACKGROUND':
      return isHexColor(action.background) ? { ...state, background: action.background } : state
    case 'SET_VIEWPORT':
      return isValidViewport(action.viewport)
        ? {
            ...state,
            viewport: action.viewport,
            viewportMarker: state.viewportMarker !== null && state.viewportMarker < action.viewport.height
              ? state.viewportMarker
              : null
          }
        : state
    case 'SET_VIEWPORT_MARKER':
      return action.marker === null || (
        Number.isInteger(action.marker) &&
        action.marker > 0 &&
        action.marker < state.viewport.height
      )
        ? { ...state, viewportMarker: action.marker }
        : state
    case 'PATCH_SEQUENCE_TITLES':
      return {
        ...state,
        sequenceTitles: sanitizePresentationSettings({
          sequenceTitles: { ...state.sequenceTitles, ...action.patch }
        }).sequenceTitles
      }
    case 'SET_LOGO':
      return { ...state, brand: { ...state.brand, logoUrl: action.url, logoName: action.name, logoSourceKey: action.sourceKey } }
    case 'REMOVE_LOGO':
      return { ...state, brand: { ...state.brand, logoUrl: null, logoName: null, logoSourceKey: null } }
    case 'PATCH_BRAND':
      return {
        ...state,
        brand: {
          ...state.brand,
          ...sanitizePresentationSettings({ brand: { ...state.brand, ...action.patch } }).brand
        }
      }
    case 'SET_CHROME_MODE':
      return { ...state, chromeMode: action.mode, isHelpOpen: false }
    case 'SET_HELP_OPEN':
      return { ...state, isHelpOpen: action.value }
    case 'RESTORE_PRESENTATION': {
      const restored = createInitialState(action.settings)
      const activeId = action.activeId && action.slides.some((slide) => slide.id === action.activeId)
        ? action.activeId
        : action.slides[0]?.id ?? null
      return {
        ...restored,
        slides: action.slides,
        references: action.references,
        activeId,
        brand: action.logo
          ? { ...restored.brand, logoUrl: action.logo.url, logoName: action.logo.name, logoSourceKey: action.logo.sourceKey }
          : restored.brand
      }
    }
  }
}
