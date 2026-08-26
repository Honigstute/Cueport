import type { CueportHost } from '../../shared/projects'
import { CANVAS_FRAMES, DISPLAY_MODES } from '../../shared/presentation'
import type {
  CanvasFrame,
  DisplayMode,
  LogoPosition,
  PhoneBrowserBarsSettings,
  PresentationBrandSettings,
  PresentationSettings,
  SequenceTitleSettings,
  ViewportSize
} from '../../shared/presentation'

export { CANVAS_FRAMES, DISPLAY_MODES }
export type { CanvasFrame, DisplayMode, LogoPosition, PhoneBrowserBarsSettings, SequenceTitleSettings, ViewportSize }

export type ViewportCategory = 'Desktop' | 'Laptop' | 'Mobile'

export interface SlideAsset {
  id: string
  name: string
  url: string
  thumbnailUrl: string
  width: number
  height: number
  origin: 'local' | 'demo'
  sourceKey: string | null
}

/** Reference assets share the image pipeline but never become presentation slides. */
export type ReferenceAsset = SlideAsset

export type ChromeMode = 'hidden' | 'top' | 'all' | 'sequence' | 'settings'

export interface BrandSettings extends PresentationBrandSettings {
  logoUrl: string | null
  logoName: string | null
  logoSourceKey: string | null
}

export interface PresentationState {
  slides: SlideAsset[]
  references: ReferenceAsset[]
  activeId: string | null
  mode: DisplayMode
  viewportEnabled: boolean
  canvasStartAtTop: boolean
  canvasRoundedCorners: boolean
  canvasImageGlow: boolean
  referenceImageShadow: boolean
  canvasFrame: CanvasFrame
  programBarColor: string
  phoneBrowserBars: PhoneBrowserBarsSettings
  background: string
  viewport: ViewportSize
  viewportMarker: number | null
  sequenceTitles: SequenceTitleSettings
  brand: BrandSettings
  chromeMode: ChromeMode
  isHelpOpen: boolean
}

export type StoredSettings = PresentationSettings

export interface ToastMessage {
  id: number
  tone: 'success' | 'error' | 'info'
  text: string
}

declare global {
  interface Window {
    cueport?: CueportHost<File>
  }
}

export {}
