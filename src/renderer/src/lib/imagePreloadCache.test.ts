import { describe, expect, it, vi } from 'vitest'
import { ImagePreloadCache } from './imagePreloadCache'

describe('ImagePreloadCache', () => {
  it('reuses cached decode work and refreshes its recency', async () => {
    const createEntry = vi.fn(() => ({
      ready: Promise.resolve(),
      release: vi.fn()
    }))
    const cache = new ImagePreloadCache(2, createEntry)

    const first = cache.preload('/one.jpg')
    const reused = cache.preload('/one.jpg')

    expect(reused).toBe(first)
    expect(createEntry).toHaveBeenCalledTimes(1)
    await reused
  })

  it('releases only the least recently used image at capacity', () => {
    const releases = new Map<string, ReturnType<typeof vi.fn>>()
    const cache = new ImagePreloadCache(2, (url) => {
      const release = vi.fn()
      releases.set(url, release)
      return { ready: Promise.resolve(), release }
    })

    void cache.preload('/one.jpg')
    void cache.preload('/two.jpg')
    void cache.preload('/one.jpg')
    void cache.preload('/three.jpg')

    expect(releases.get('/one.jpg')).not.toHaveBeenCalled()
    expect(releases.get('/two.jpg')).toHaveBeenCalledOnce()
    expect(releases.get('/three.jpg')).not.toHaveBeenCalled()
  })

  it('rejects an invalid memory bound', () => {
    expect(() => new ImagePreloadCache(0)).toThrowError(RangeError)
  })

  it('releases every retained image when explicitly cleared', () => {
    const release = vi.fn()
    const cache = new ImagePreloadCache(2, () => ({
      ready: Promise.resolve(),
      release
    }))

    void cache.preload('/one.jpg')
    void cache.preload('/two.jpg')
    cache.clear()

    expect(release).toHaveBeenCalledTimes(2)
  })
})
