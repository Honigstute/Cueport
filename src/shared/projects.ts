import type { PresentationAssetMimeType, PresentationImageMimeType, PresentationSettings } from './presentation'

/**
 * Desktop runtime contracts shared by Electron and the renderer.
 * The portable on-disk format lives in presentation.ts; opaque source keys and
 * local URLs exist only while the desktop app is running.
 */
export interface SavedPresentationSummary {
  id: string
  name: string
  updatedAt: string
  previewUrl: string | null
  slideCount: number
}

export interface SavePresentationSlide {
  id: string
  name: string
  width: number
  height: number
  sourceKey: string | null
}

export interface SavePresentationRequest {
  id: string | null
  name: string
  activeSlideId: string | null
  settings: PresentationSettings
  slides: SavePresentationSlide[]
  references: SavePresentationSlide[]
  brand: {
    logoName: string | null
    sourceKey: string | null
  }
  previewDataUrl: string | null
}

export interface OpenPresentationSlide {
  id: string
  name: string
  width: number
  height: number
  assetKey: string
  mimeType: PresentationImageMimeType
  sourceKey: string
  url: string
}

export interface OpenPresentationResult {
  summary: SavedPresentationSummary
  activeSlideId: string | null
  settings: PresentationSettings
  slides: OpenPresentationSlide[]
  references: OpenPresentationSlide[]
  brand: {
    logoName: string
    assetKey: string
    mimeType: PresentationAssetMimeType
    sourceKey: string
    url: string
  } | null
}

export type DesktopPlatform = 'aix' | 'darwin' | 'freebsd' | 'linux' | 'openbsd' | 'sunos' | 'win32'

/** The renderer's intentionally small, replaceable interface to its host. */
export interface CueportHost<ImportedFile = unknown> {
  runtime: 'desktop'
  platform: DesktopPlatform
  registerImportedFile: (file: ImportedFile) => Promise<string | null>
  renameImportedFile: (sourceKey: string, name: string) => Promise<{ name: string }>
  listPresentations: () => Promise<SavedPresentationSummary[]>
  savePresentation: (request: SavePresentationRequest) => Promise<SavedPresentationSummary>
  openPresentation: (id: string) => Promise<OpenPresentationResult>
  renamePresentation: (id: string, name: string) => Promise<SavedPresentationSummary>
  deletePresentation: (id: string) => Promise<void>
  reorderPresentations: (ids: string[]) => Promise<void>
}
