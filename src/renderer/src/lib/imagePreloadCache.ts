interface ImagePreloadEntry {
  ready: Promise<void>
  release: () => void
}

type ImagePreloadEntryFactory = (url: string) => ImagePreloadEntry

const DEFAULT_CACHE_CAPACITY = 5

function createBrowserImagePreloadEntry(url: string): ImagePreloadEntry {
  if (typeof Image === 'undefined') {
    return { ready: Promise.resolve(), release: () => undefined }
  }

  const preloadImage = new Image()
  let image: HTMLImageElement | null = preloadImage
  let finish: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    let settled = false
    finish = (): void => {
      if (settled) return
      settled = true
      if (image) {
        image.onload = null
        image.onerror = null
      }
      resolve()
    }

    preloadImage.decoding = 'async'
    preloadImage.onload = () => {
      const loadedImage = image
      if (!loadedImage || typeof loadedImage.decode !== 'function') {
        finish()
        return
      }
      void loadedImage.decode().then(finish, finish)
    }
    preloadImage.onerror = finish
    preloadImage.src = url
  })

  return {
    ready,
    release: () => {
      if (!image) return
      const releasedImage = image
      releasedImage.onload = null
      releasedImage.onerror = null
      releasedImage.removeAttribute('src')
      image = null
      finish()
    }
  }
}

/**
 * A tiny LRU of decoded image resources shared by every presentation surface.
 * Browser image caches normally share the decoded pixels with the visible img,
 * so keeping only a handful here removes repeat decoding without retaining an
 * entire presentation of memory-heavy screenshots.
 */
export class ImagePreloadCache {
  private readonly entries = new Map<string, ImagePreloadEntry>()

  constructor(
    private readonly capacity = DEFAULT_CACHE_CAPACITY,
    private readonly createEntry: ImagePreloadEntryFactory = createBrowserImagePreloadEntry
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('Image preload cache capacity must be a positive integer.')
    }
  }

  preload(url: string): Promise<void> {
    const normalizedUrl = url.trim()
    if (!normalizedUrl) return Promise.resolve()

    const cached = this.entries.get(normalizedUrl)
    if (cached) {
      // Map insertion order doubles as the LRU list.
      this.entries.delete(normalizedUrl)
      this.entries.set(normalizedUrl, cached)
      return cached.ready
    }

    const entry = this.createEntry(normalizedUrl)
    this.entries.set(normalizedUrl, entry)
    this.trimToCapacity()
    return entry.ready
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.release()
    this.entries.clear()
  }

  private trimToCapacity(): void {
    while (this.entries.size > this.capacity) {
      const oldestUrl = this.entries.keys().next().value as string | undefined
      if (!oldestUrl) return
      const oldest = this.entries.get(oldestUrl)
      this.entries.delete(oldestUrl)
      oldest?.release()
    }
  }
}

export const sharedImagePreloadCache = new ImagePreloadCache()
