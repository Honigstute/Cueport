import type { SlideAsset } from '../types'
import { mimeTypeFromFileName } from '../../../shared/presentation'

const SUPPORTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']
const SUPPORTED_VIDEO_EXTENSIONS = ['mp4']
const SUPPORTED_MEDIA_EXTENSIONS = [...SUPPORTED_IMAGE_EXTENSIONS, ...SUPPORTED_VIDEO_EXTENSIONS]
const SUPPORTED_LOGO_EXTENSIONS = [...SUPPORTED_IMAGE_EXTENSIONS, 'svg']
const MAX_IMAGE_BYTES = 150 * 1024 * 1024
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024
const MAX_LOGO_BYTES = 20 * 1024 * 1024
const VIDEO_LOAD_TIMEOUT = 15_000

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

export function isSupportedVideoName(fileName: string): boolean {
  return SUPPORTED_VIDEO_EXTENSIONS.includes(fileExtension(fileName))
}

export function isSupportedMediaName(fileName: string): boolean {
  return SUPPORTED_MEDIA_EXTENSIONS.includes(fileExtension(fileName))
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

export function createThumbnail(image: HTMLImageElement): Promise<string> {
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

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new AssetImportError('The saved preview could not be read.'))
    reader.onerror = () => reject(new AssetImportError('The saved preview could not be read.'))
    reader.readAsDataURL(blob)
  })
}

/** Read an existing saved JPEG without another lossy canvas re-encode. */
async function readPortableJpegDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new AssetImportError('The saved preview is unavailable.')
  const blob = await response.blob()
  if (blob.type !== 'image/jpeg' || blob.size > 2_000_000) {
    throw new AssetImportError('The saved preview is not a portable JPEG.')
  }
  return blobAsDataUrl(blob)
}

function createVideoThumbnail(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 200
  const context = canvas.getContext('2d')
  if (!context) return ''

  context.fillStyle = '#1D1D1D'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
  const width = video.videoWidth * scale
  const height = video.videoHeight * scale
  context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

interface LoadedVideo {
  width: number
  height: number
  thumbnailUrl: string
}

function loadVideo(url: string, fileName: string): Promise<LoadedVideo> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    let settled = false
    const timeout = window.setTimeout(() => finish(new AssetImportError(`${fileName} took too long to read.`)), VIDEO_LOAD_TIMEOUT)

    const releaseDecoder = (): void => {
      video.removeAttribute('src')
      video.load()
    }
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      if (error) {
        releaseDecoder()
        reject(error)
        return
      }
      const thumbnailUrl = createVideoThumbnail(video)
      const result = { width: video.videoWidth, height: video.videoHeight, thumbnailUrl }
      releaseDecoder()
      resolve(result)
    }

    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onerror = () => finish(new AssetImportError(`${fileName} could not be read as an MP4 video.`))
    video.onloadeddata = () => {
      if (video.videoWidth < 1 || video.videoHeight < 1) {
        finish(new AssetImportError(`${fileName} has no readable video dimensions.`))
        return
      }

      const previewTime = Number.isFinite(video.duration) && video.duration > 0.2
        ? Math.min(0.1, video.duration / 2)
        : 0
      if (previewTime <= 0.001) {
        finish()
        return
      }
      video.onseeked = () => finish()
      video.currentTime = previewTime
    }
    video.src = url
  })
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
  if (!isSupportedMediaName(file.name)) {
    throw new AssetImportError(`${file.name} is not a supported JPEG, PNG, WebP, or MP4 file.`)
  }
  const isVideo = isSupportedVideoName(file.name)
  if (!isVideo && file.size > MAX_IMAGE_BYTES) {
    throw new AssetImportError(`${file.name} is larger than the 150 MB session limit.`)
  }
  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    throw new AssetImportError(`${file.name} is larger than the 1 GB video limit.`)
  }

  const sourceKey = await registerSourceFile(file)
  const url = URL.createObjectURL(file)
  try {
    if (isVideo) {
      const video = await loadVideo(url, file.name)
      return {
        id: crypto.randomUUID(),
        name: file.name,
        url,
        thumbnailUrl: video.thumbnailUrl,
        width: video.width,
        height: video.height,
        mimeType: 'video/mp4',
        origin: 'local',
        sourceKey
      }
    }
    const image = await loadImage(url, file.name)
    const thumbnailUrl = await createThumbnail(image)
    return {
      id: crypto.randomUUID(),
      name: file.name,
      url,
      thumbnailUrl,
      width: image.naturalWidth,
      height: image.naturalHeight,
      mimeType: mimeTypeFromFileName(file.name),
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

/**
 * Keep the lightweight 320×200 media preview portable across save, reopen,
 * and web publication. Persisting image previews avoids decoding the original
 * (potentially 150 MB) artwork every time a reference picker opens.
 */
export async function createPortableThumbnailDataUrl(slide: SlideAsset): Promise<string | null> {
  if (slide.thumbnailUrl.startsWith('data:image/jpeg;base64,') && slide.thumbnailUrl.length <= 2_000_000) {
    return slide.thumbnailUrl
  }

  // Reopened projects already point at a saved poster. Reuse that lightweight
  // image before touching the original media—especially for large MP4 files.
  if (slide.thumbnailUrl && slide.thumbnailUrl !== slide.url) {
    try {
      return await readPortableJpegDataUrl(slide.thumbnailUrl)
    } catch {
      // A missing legacy poster falls through to the original media below.
    }
  }

  try {
    if (slide.mimeType.startsWith('image/')) {
      return await createThumbnail(await loadImage(slide.url, slide.name))
    }
    return (await loadVideo(slide.url, slide.name)).thumbnailUrl || null
  } catch {
    return null
  }
}

/** Prevent a large project save from opening hundreds of media decoders at once. */
export async function createPortableThumbnailDataUrls(
  slides: SlideAsset[],
  concurrency = 4
): Promise<Array<string | null>> {
  const results = new Array<string | null>(slides.length)
  let nextIndex = 0
  const workerCount = Math.min(slides.length, Math.max(1, Math.floor(concurrency)))

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < slides.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await createPortableThumbnailDataUrl(slides[index])
    }
  }))

  return results
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
