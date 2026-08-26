/**
 * Cueport's portable presentation document.
 *
 * This module deliberately has no Electron, filesystem, or browser dependency.
 * Desktop persistence, a future publishing API, and the web viewer can all use
 * the same validation and migration rules without leaking local file paths.
 */

export const PRESENTATION_DOCUMENT_VERSION = 1 as const
export const DISPLAY_MODES = ['fit-width', 'canvas'] as const
export const CANVAS_FRAMES = ['none', 'mac', 'windows', 'phone'] as const
export const PRESENTATION_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const PRESENTATION_ASSET_MIME_TYPES = [...PRESENTATION_IMAGE_MIME_TYPES, 'image/svg+xml'] as const

export type DisplayMode = (typeof DISPLAY_MODES)[number]
export type CanvasFrame = (typeof CANVAS_FRAMES)[number]
export type PresentationImageMimeType = (typeof PRESENTATION_IMAGE_MIME_TYPES)[number]
export type PresentationAssetMimeType = (typeof PRESENTATION_ASSET_MIME_TYPES)[number]
export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface ViewportSize {
  label: string
  width: number
  height: number
}

export interface SequenceTitleSettings {
  hideExtension: boolean
  preferEnding: boolean
}

export interface PhoneBrowserBarsSettings {
  enabled: boolean
  color: string
}

export interface PresentationBrandSettings {
  position: LogoPosition
  width: number
  opacity: number
  margin: number
  showOnCanvas: boolean
}

export interface PresentationSettings {
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
  brand: PresentationBrandSettings
}

export interface PresentationDocumentImage {
  id: string
  name: string
  width: number
  height: number
  /** Safe, relative object key. Never an absolute local filesystem path. */
  assetKey: string
  mimeType: PresentationImageMimeType
}

export interface PresentationDocumentBrand {
  name: string
  assetKey: string
  mimeType: PresentationAssetMimeType
}

export interface PresentationDocument {
  schemaVersion: typeof PRESENTATION_DOCUMENT_VERSION
  id: string
  name: string
  createdAt: string
  updatedAt: string
  activeSlideId: string
  settings: PresentationSettings
  slides: PresentationDocumentImage[]
  references: PresentationDocumentImage[]
  brand: PresentationDocumentBrand | null
}

export const DEFAULT_VIEWPORT: ViewportSize = { label: 'Desktop', width: 1920, height: 1080 }
export const DEFAULT_CANVAS_BACKGROUND = '#F5F6F7'
export const DEFAULT_PROGRAM_BAR_COLOR = '#D9DCE0'
export const DEFAULT_PHONE_BROWSER_BARS: PhoneBrowserBarsSettings = {
  enabled: false,
  color: '#F4F5F7'
}

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = {
  mode: 'fit-width',
  viewportEnabled: false,
  canvasStartAtTop: false,
  canvasRoundedCorners: true,
  canvasImageGlow: false,
  referenceImageShadow: false,
  canvasFrame: 'none',
  programBarColor: DEFAULT_PROGRAM_BAR_COLOR,
  phoneBrowserBars: { ...DEFAULT_PHONE_BROWSER_BARS },
  background: DEFAULT_CANVAS_BACKGROUND,
  viewport: { ...DEFAULT_VIEWPORT },
  viewportMarker: null,
  sequenceTitles: {
    hideExtension: false,
    preferEnding: false
  },
  brand: {
    position: 'top-right',
    width: 120,
    opacity: 1,
    margin: 28,
    showOnCanvas: true
  }
}

const LEGACY_DESKTOP_VIEWPORT: ViewportSize = { label: 'Desktop', width: 1440, height: 900 }
const LEGACY_CANVAS_MODES = new Set(['fit-screen', 'actual-size', 'viewport', 'free', 'zoom'])
const LOGO_POSITIONS: LogoPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const IDENTIFIER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const MAX_IMAGES_PER_COLLECTION = 500

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function clampNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

function sanitizeViewport(value: unknown): ViewportSize {
  if (!isRecord(value)) return { ...DEFAULT_VIEWPORT }
  const label = typeof value.label === 'string' ? value.label : ''
  const width = Number(value.width)
  const height = Number(value.height)
  const isValid = label.trim().length > 0 && label.length <= 80 &&
    Number.isInteger(width) && Number.isInteger(height) && width >= 240 && width <= 10000 && height >= 240 && height <= 10000
  if (!isValid) return { ...DEFAULT_VIEWPORT }
  if (label === LEGACY_DESKTOP_VIEWPORT.label && width === LEGACY_DESKTOP_VIEWPORT.width && height === LEGACY_DESKTOP_VIEWPORT.height) {
    return { ...DEFAULT_VIEWPORT }
  }
  return { label: label.trim(), width, height }
}

/**
 * Sanitizes current settings and all settings formats used by older desktop
 * builds. Unknown fields are ignored so future additions remain forward-safe.
 */
export function sanitizePresentationSettings(value: unknown): PresentationSettings {
  const candidate = isRecord(value) ? value : {}
  const storedMode = typeof candidate.mode === 'string' ? candidate.mode : undefined
  const mode: DisplayMode = storedMode === 'fit-width'
    ? 'fit-width'
    : storedMode === 'canvas' || LEGACY_CANVAS_MODES.has(storedMode ?? '')
      ? 'canvas'
      : DEFAULT_PRESENTATION_SETTINGS.mode
  const viewport = sanitizeViewport(candidate.viewport)
  const phoneBars = isRecord(candidate.phoneBrowserBars) ? candidate.phoneBrowserBars : {}
  const storedPhoneBarColor = [phoneBars.color, phoneBars.topColor, phoneBars.bottomColor]
    .find(isHexColor) ?? DEFAULT_PHONE_BROWSER_BARS.color
  const sequenceTitles = isRecord(candidate.sequenceTitles) ? candidate.sequenceTitles : {}
  const brand = isRecord(candidate.brand) ? candidate.brand : {}
  const viewportMarker = Number(candidate.viewportMarker)

  return {
    mode,
    viewportEnabled: typeof candidate.viewportEnabled === 'boolean'
      ? candidate.viewportEnabled
      : storedMode === 'viewport',
    canvasStartAtTop: typeof candidate.canvasStartAtTop === 'boolean'
      ? candidate.canvasStartAtTop
      : DEFAULT_PRESENTATION_SETTINGS.canvasStartAtTop,
    canvasRoundedCorners: typeof candidate.canvasRoundedCorners === 'boolean'
      ? candidate.canvasRoundedCorners
      : DEFAULT_PRESENTATION_SETTINGS.canvasRoundedCorners,
    canvasImageGlow: typeof candidate.canvasImageGlow === 'boolean'
      ? candidate.canvasImageGlow
      : DEFAULT_PRESENTATION_SETTINGS.canvasImageGlow,
    referenceImageShadow: typeof candidate.referenceImageShadow === 'boolean'
      ? candidate.referenceImageShadow
      : DEFAULT_PRESENTATION_SETTINGS.referenceImageShadow,
    canvasFrame: CANVAS_FRAMES.includes(candidate.canvasFrame as CanvasFrame)
      ? candidate.canvasFrame as CanvasFrame
      : DEFAULT_PRESENTATION_SETTINGS.canvasFrame,
    programBarColor: isHexColor(candidate.programBarColor)
      ? candidate.programBarColor
      : DEFAULT_PRESENTATION_SETTINGS.programBarColor,
    phoneBrowserBars: {
      enabled: typeof phoneBars.enabled === 'boolean' ? phoneBars.enabled : DEFAULT_PHONE_BROWSER_BARS.enabled,
      color: storedPhoneBarColor
    },
    background: isHexColor(candidate.background) ? candidate.background : DEFAULT_PRESENTATION_SETTINGS.background,
    viewport,
    viewportMarker: Number.isInteger(viewportMarker) && viewportMarker > 0 && viewportMarker < viewport.height
      ? viewportMarker
      : null,
    sequenceTitles: {
      hideExtension: typeof sequenceTitles.hideExtension === 'boolean'
        ? sequenceTitles.hideExtension
        : DEFAULT_PRESENTATION_SETTINGS.sequenceTitles.hideExtension,
      preferEnding: typeof sequenceTitles.preferEnding === 'boolean'
        ? sequenceTitles.preferEnding
        : DEFAULT_PRESENTATION_SETTINGS.sequenceTitles.preferEnding
    },
    brand: {
      position: LOGO_POSITIONS.includes(brand.position as LogoPosition)
        ? brand.position as LogoPosition
        : DEFAULT_PRESENTATION_SETTINGS.brand.position,
      width: clampNumber(brand.width, DEFAULT_PRESENTATION_SETTINGS.brand.width, 48, 240),
      opacity: clampNumber(brand.opacity, DEFAULT_PRESENTATION_SETTINGS.brand.opacity, 0.2, 1),
      margin: clampNumber(brand.margin, DEFAULT_PRESENTATION_SETTINGS.brand.margin, 8, 80),
      showOnCanvas: typeof brand.showOnCanvas === 'boolean'
        ? brand.showOnCanvas
        : DEFAULT_PRESENTATION_SETTINGS.brand.showOnCanvas
    }
  }
}

export function mimeTypeFromFileName(fileName: string): PresentationImageMimeType
export function mimeTypeFromFileName(fileName: string, allowSvg: true): PresentationAssetMimeType
export function mimeTypeFromFileName(fileName: string, allowSvg = false): PresentationAssetMimeType {
  const extension = fileName.toLowerCase().split('.').pop()
  switch (extension) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'svg':
      if (allowSvg) return 'image/svg+xml'
      break
  }
  throw new Error('A presentation asset uses an unsupported file type.')
}

function validateIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} has an invalid identifier.`)
  }
  return value
}

function validateName(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} has no name.`)
  const name = value.trim()
  if (!name || name.length > maximumLength || /[\u0000-\u001F]/.test(name)) {
    throw new Error(`${label} has an invalid name.`)
  }
  return name
}

function validateDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} has an invalid date.`)
  }
  return value
}

export function validateAssetKey(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500 || value.startsWith('/') || value.includes('\\')) {
    throw new Error('A presentation asset has an invalid key.')
  }
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\u0000-\u001F]/.test(segment))) {
    throw new Error('A presentation asset has an unsafe key.')
  }
  return value
}

function validateImageCollection(value: unknown, label: 'slide' | 'reference'): PresentationDocumentImage[] {
  if (!Array.isArray(value) || (label === 'slide' && value.length === 0) || value.length > MAX_IMAGES_PER_COLLECTION) {
    throw new Error(`The presentation has an invalid ${label} collection.`)
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new Error(`A presentation ${label} is unreadable.`)
    const width = Number(candidate.width)
    const height = Number(candidate.height)
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 100000 || height > 100000) {
      throw new Error(`A presentation ${label} has invalid dimensions.`)
    }
    if (!PRESENTATION_IMAGE_MIME_TYPES.includes(candidate.mimeType as PresentationImageMimeType)) {
      throw new Error(`A presentation ${label} uses an unsupported image type.`)
    }
    return {
      id: validateIdentifier(candidate.id, `A presentation ${label}`),
      name: validateName(candidate.name, `A presentation ${label}`, 300),
      width,
      height,
      assetKey: validateAssetKey(candidate.assetKey),
      mimeType: candidate.mimeType as PresentationImageMimeType
    }
  })
}

/** Parse and normalize a portable document received from disk or a future API. */
export function parsePresentationDocument(value: unknown): PresentationDocument {
  if (!isRecord(value) || value.schemaVersion !== PRESENTATION_DOCUMENT_VERSION) {
    throw new Error('The presentation document format is unsupported.')
  }
  const slides = validateImageCollection(value.slides, 'slide')
  const references = validateImageCollection(value.references ?? [], 'reference')
  const ids = [...slides, ...references].map((asset) => asset.id)
  if (new Set(ids).size !== ids.length) throw new Error('The presentation contains duplicate image identifiers.')

  let brand: PresentationDocumentBrand | null = null
  if (value.brand !== null && value.brand !== undefined) {
    if (!isRecord(value.brand) || !PRESENTATION_ASSET_MIME_TYPES.includes(value.brand.mimeType as PresentationAssetMimeType)) {
      throw new Error('The presentation brand asset is unreadable.')
    }
    brand = {
      name: validateName(value.brand.name, 'The presentation brand asset', 300),
      assetKey: validateAssetKey(value.brand.assetKey),
      mimeType: value.brand.mimeType as PresentationAssetMimeType
    }
  }

  const activeSlideId = typeof value.activeSlideId === 'string' && slides.some((slide) => slide.id === value.activeSlideId)
    ? value.activeSlideId
    : slides[0].id
  return {
    schemaVersion: PRESENTATION_DOCUMENT_VERSION,
    id: validateIdentifier(value.id, 'The presentation'),
    name: validateName(value.name, 'The presentation', 120),
    createdAt: validateDate(value.createdAt, 'The presentation creation date'),
    updatedAt: validateDate(value.updatedAt, 'The presentation update date'),
    activeSlideId,
    settings: sanitizePresentationSettings(value.settings),
    slides,
    references,
    brand
  }
}

/**
 * Reads both the portable document and the original desktop-only version 1
 * file. Saving the result writes the portable format, completing migration.
 */
export function parseDesktopPresentationFile(value: unknown): PresentationDocument {
  if (isRecord(value) && value.schemaVersion === PRESENTATION_DOCUMENT_VERSION) {
    return parsePresentationDocument(value)
  }
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('The saved presentation format is unsupported.')
  }

  const migrateImages = (images: unknown, label: 'slide' | 'reference'): PresentationDocumentImage[] => {
    if (!Array.isArray(images)) {
      if (label === 'reference') return []
      throw new Error('The saved presentation is missing its images.')
    }
    return images.map((candidate) => {
      if (!isRecord(candidate) || typeof candidate.assetFile !== 'string') {
        throw new Error(`A saved ${label} image is unreadable.`)
      }
      const assetKey = candidate.assetFile.replaceAll('\\', '/')
      return {
        id: candidate.id as string,
        name: candidate.name as string,
        width: candidate.width as number,
        height: candidate.height as number,
        assetKey,
        mimeType: mimeTypeFromFileName(assetKey)
      }
    })
  }

  let brand: PresentationDocumentBrand | null = null
  if (isRecord(value.brand) && typeof value.brand.assetFile === 'string' && typeof value.brand.logoName === 'string') {
    const assetKey = value.brand.assetFile.replaceAll('\\', '/')
    brand = {
      name: value.brand.logoName,
      assetKey,
      mimeType: mimeTypeFromFileName(assetKey, true)
    }
  }

  const fallbackDate = new Date().toISOString()
  const slides = migrateImages(value.slides, 'slide')
  const document: PresentationDocument = {
    schemaVersion: PRESENTATION_DOCUMENT_VERSION,
    id: value.id as string,
    name: value.name as string,
    createdAt: typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt)) ? value.createdAt : fallbackDate,
    updatedAt: typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
      ? value.updatedAt
      : typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
        ? value.createdAt
        : fallbackDate,
    activeSlideId: typeof value.activeSlideId === 'string' ? value.activeSlideId : slides[0]?.id ?? '',
    settings: sanitizePresentationSettings(value.settings),
    slides,
    references: migrateImages(value.references, 'reference'),
    brand
  }
  return parsePresentationDocument(document)
}
