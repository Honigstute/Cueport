import type { SlideAsset } from '../types'

const SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const SUPPORTED_LOGO_EXTENSIONS = [...SUPPORTED_IMAGE_EXTENSIONS, 'svg']
const MAX_IMAGE_BYTES = 150 * 1024 * 1024
const MAX_LOGO_BYTES = 20 * 1024 * 1024

export class AssetImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetImportError'
  }
}

function fileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function isSupportedImageName(fileName: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.includes(fileExtension(fileName))
}

export function isSupportedLogoName(fileName: string): boolean {
  return SUPPORTED_LOGO_EXTENSIONS.includes(fileExtension(fileName))
}

function loadImage(url: string, fileName: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        reject(new AssetImportError(`${fileName} has no readable image dimensions.`))
        return
      }
      resolve(image)
    }
    image.onerror = () => reject(new AssetImportError(`${fileName} could not be read as an image.`))
    image.src = url
  })
}

async function registerSourceFile(file: File): Promise<string | null> {
  try {
    return await window.cueport?.registerImportedFile(file) ?? null
  } catch {
    // Import remains useful in web previews or if the source file becomes
    // unavailable. Renaming then applies only to the in-session title.
    return null
  }
}

function createThumbnail(image: HTMLImageElement): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 200
  const context = canvas.getContext('2d')
  if (!context) return Promise.resolve(image.src)

  const sourceHeight = Math.min(image.naturalHeight, image.naturalWidth * (canvas.height / canvas.width))
  context.fillStyle = '#FFFFFF'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    image,
    0,
    0,
    image.naturalWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height
  )

  return Promise.resolve(canvas.toDataURL('image/jpeg', 0.76))
}

function createLogoThumbnail(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 200
  const context = canvas.getContext('2d')
  if (!context) return image.src

  context.fillStyle = '#F4F5F7'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const scale = Math.min(240 / image.naturalWidth, 130 / image.naturalHeight)
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

export async function createSlideAsset(file: File): Promise<SlideAsset> {
  if (!isSupportedImageName(file.name)) {
    throw new AssetImportError(`${file.name} is not a supported JPEG, PNG, or WebP file.`)
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AssetImportError(`${file.name} is larger than the 150 MB session limit.`)
  }

  const sourceKey = await registerSourceFile(file)
  const url = URL.createObjectURL(file)
  try {
    const image = await loadImage(url, file.name)
    const thumbnailUrl = await createThumbnail(image)
    return {
      id: crypto.randomUUID(),
      name: file.name,
      url,
      thumbnailUrl,
      width: image.naturalWidth,
      height: image.naturalHeight,
      origin: 'local',
      sourceKey
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

export async function createLogoAsset(file: File): Promise<{ name: string; url: string; sourceKey: string | null }> {
  if (!isSupportedLogoName(file.name)) {
    throw new AssetImportError(`${file.name} is not a supported logo file.`)
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new AssetImportError(`${file.name} is larger than the 20 MB logo limit.`)
  }

  const sourceKey = await registerSourceFile(file)
  const url = URL.createObjectURL(file)
  try {
    await loadImage(url, file.name)
    return { name: file.name, url, sourceKey }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/**
 * Creates the recoverable home-card preview. A client logo deliberately wins
 * over slide artwork even when it is hidden on the canvas; the logo still acts
 * as the presentation's identity in the library.
 */
export async function createPresentationPreviewDataUrl(slide: SlideAsset, logoUrl: string | null): Promise<string | null> {
  if (logoUrl) {
    try {
      return createLogoThumbnail(await loadImage(logoUrl, 'Client logo'))
    } catch {
      // A missing logo must never prevent the presentation itself from saving.
    }
  }
  if (slide.thumbnailUrl.startsWith('data:image/jpeg;base64,') && slide.thumbnailUrl.length <= 2_000_000) {
    return slide.thumbnailUrl
  }
  try {
    return await createThumbnail(await loadImage(slide.thumbnailUrl, slide.name))
  } catch {
    return null
  }
}

export function revokeLocalAsset(url: string | null): void {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

export function revokeSlideAsset(slide: SlideAsset): void {
  revokeLocalAsset(slide.url)
  if (slide.thumbnailUrl !== slide.url) revokeLocalAsset(slide.thumbnailUrl)
}

export function formatDimensions(width: number, height: number): string {
  return `${width.toLocaleString()} × ${height.toLocaleString()}`
}
