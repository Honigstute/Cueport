import { mimeTypeFromFileName, type PresentationAssetMimeType, type PresentationMediaMimeType } from '../../../../src/shared/presentation'
import { shouldOptimizeLargePng } from '../../../../src/shared/pngOptimization'
import { createLogoAsset, createSlideAsset } from '../../../../src/renderer/src/lib/assets'
import type { SlideAsset } from '../../../../src/renderer/src/types'
import type { PendingEditorAsset } from './webEditorPublication'

const MAX_WEB_ASSET_BYTES = 500 * 1024 * 1024
const PNG_METADATA_PREFIX_BYTES = 2 * 1024 * 1024
const JPEG_IMPORT_QUALITY = 0.85

function extensionForMimeType(mimeType: PresentationMediaMimeType | PresentationAssetMimeType): string {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg'
    case 'image/png': return 'png'
    case 'image/webp': return 'webp'
    case 'image/svg+xml': return 'svg'
    case 'video/mp4': return 'mp4'
  }
}

async function jpegDataUrlBlob(value: string): Promise<Blob | null> {
  if (!value.startsWith('data:image/jpeg')) return null
  return fetch(value).then((response) => response.blob())
}

function loadBrowserImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The PNG could not be prepared for upload.'))
    image.src = url
  })
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_IMPORT_QUALITY))
}

/** Match the desktop rule: only large, proven-opaque PNGs become 85% JPEGs. */
async function optimizeLargePng(file: File): Promise<File> {
  const header = new Uint8Array(await file.slice(0, PNG_METADATA_PREFIX_BYTES).arrayBuffer())
  if (!shouldOptimizeLargePng(file.name, file.size, header)) return file

  const url = URL.createObjectURL(file)
  try {
    const image = await loadBrowserImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) return file
    context.fillStyle = '#FFFFFF'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0)
    const jpeg = await canvasJpeg(canvas)
    if (!jpeg || jpeg.size >= file.size) return file
    const baseName = file.name.replace(/\.png$/i, '') || 'image'
    return new File([jpeg], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface ImportedWebMedia {
  asset: SlideAsset
  assetKey: string
  pending: Array<[string, PendingEditorAsset]>
  posterKey: string | null
}

/** Imports browser media into the same renderer model used by the desktop app. */
export async function importWebMedia(file: File, collection: 'slides' | 'references'): Promise<ImportedWebMedia> {
  if (file.size > MAX_WEB_ASSET_BYTES) throw new Error(`${file.name} is larger than the 500 MB web upload limit.`)
  const preparedFile = await optimizeLargePng(file)
  const asset = await createSlideAsset(preparedFile)
  const assetKey = `${collection}/${asset.id}.${extensionForMimeType(asset.mimeType)}`
  // Every web import gets the renderer's lightweight 320×200 JPEG poster.
  // This is only a preview: transparent PNG source artwork remains PNG.
  const poster = await jpegDataUrlBlob(asset.thumbnailUrl)
  const posterKey = poster ? `thumbnails/${asset.id}.jpg` : null
  return {
    asset: { ...asset, sourceKey: assetKey },
    assetKey,
    posterKey,
    pending: [
      [assetKey, { blob: preparedFile, mimeType: asset.mimeType }],
      ...(poster && posterKey ? [[posterKey, { blob: poster, mimeType: 'image/jpeg' as const }] as [string, PendingEditorAsset]] : [])
    ]
  }
}

export interface ImportedWebLogo {
  name: string
  url: string
  assetKey: string
  pending: PendingEditorAsset
}

export async function importWebLogo(file: File): Promise<ImportedWebLogo> {
  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    throw new Error('Use a PNG, JPEG, or WebP client mark in the web editor.')
  }
  if (file.size > MAX_WEB_ASSET_BYTES) throw new Error(`${file.name} is larger than the 500 MB web upload limit.`)
  const logo = await createLogoAsset(file)
  const mimeType = mimeTypeFromFileName(file.name, true)
  const assetKey = `assets/logo-${crypto.randomUUID()}.${extensionForMimeType(mimeType)}`
  return {
    name: logo.name,
    url: logo.url,
    assetKey,
    pending: { blob: file, mimeType }
  }
}
