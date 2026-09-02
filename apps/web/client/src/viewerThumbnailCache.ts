import { createThumbnail } from '../../../../src/renderer/src/lib/assets'

type ThumbnailGenerator = (sourceUrl: string) => Promise<string | null>

const DEFAULT_CAPACITY = 128

function loadImage(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The legacy thumbnail could not be loaded.'))
    image.src = sourceUrl
  })
}

/**
 * Older published documents have no dedicated poster asset. Generate a tiny
 * in-memory JPEG only after the renderer is already warming that full image.
 */
async function generateBrowserThumbnail(sourceUrl: string): Promise<string | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null
  try {
    const image = await loadImage(sourceUrl)
    if (typeof image.decode === 'function') await image.decode().catch(() => undefined)
    if (image.naturalWidth < 1 || image.naturalHeight < 1) return null
    return await createThumbnail(image)
  } catch {
    return null
  }
}

/** Small LRU for generated legacy thumbnails. Promise entries deduplicate
 * toolbar work while the browser reuses the renderer's already-warmed source. */
export class ViewerThumbnailCache {
  private readonly entries = new Map<string, Promise<string | null>>()

  constructor(
    private readonly capacity = DEFAULT_CAPACITY,
    private readonly generate: ThumbnailGenerator = generateBrowserThumbnail
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('Viewer thumbnail cache capacity must be a positive integer.')
    }
  }

  get(sourceUrl: string): Promise<string | null> {
    const normalizedUrl = sourceUrl.trim()
    if (!normalizedUrl) return Promise.resolve(null)

    const cached = this.entries.get(normalizedUrl)
    if (cached) {
      this.entries.delete(normalizedUrl)
      this.entries.set(normalizedUrl, cached)
      return cached
    }

    const generated = this.generate(normalizedUrl)
    this.entries.set(normalizedUrl, generated)
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (!oldest) break
      this.entries.delete(oldest)
    }
    return generated
  }
}

export const sharedViewerThumbnailCache = new ViewerThumbnailCache()
