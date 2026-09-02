import { describe, expect, it, vi } from 'vitest'
import { ViewerThumbnailCache } from './viewerThumbnailCache'

describe('ViewerThumbnailCache', () => {
  it('reuses one generated preview for repeated requests', async () => {
    const generate = vi.fn(async (url: string) => `preview:${url}`)
    const cache = new ViewerThumbnailCache(2, generate)

    const first = cache.get('/one.jpg')
    const reused = cache.get('/one.jpg')

    expect(reused).toBe(first)
    await expect(reused).resolves.toBe('preview:/one.jpg')
    expect(generate).toHaveBeenCalledOnce()
  })

  it('keeps the most recently used previews within a fixed memory bound', async () => {
    const generate = vi.fn(async (url: string) => `preview:${url}`)
    const cache = new ViewerThumbnailCache(2, generate)

    await cache.get('/one.jpg')
    await cache.get('/two.jpg')
    await cache.get('/one.jpg')
    await cache.get('/three.jpg')
    await cache.get('/two.jpg')

    expect(generate).toHaveBeenCalledTimes(4)
  })

  it('rejects an invalid memory bound', () => {
    expect(() => new ViewerThumbnailCache(0)).toThrowError(RangeError)
  })
})
