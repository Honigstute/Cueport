import { useEffect, useRef } from 'react'
import type { SlideAsset } from '../types'
import { adjacentMediaPreloadUrls } from '../lib/mediaPreload'

/**
 * Holds at most three decoded stills. This removes most navigation waits
 * without retaining an entire presentation of memory-heavy 4K screenshots.
 */
export function useAdjacentMediaPreload(slides: SlideAsset[], activeIndex: number): void {
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map())

  useEffect(() => {
    const urls = adjacentMediaPreloadUrls(slides, activeIndex)
    const desired = new Set(urls)

    for (const [url, image] of imagesRef.current) {
      if (desired.has(url)) continue
      image.removeAttribute('src')
      imagesRef.current.delete(url)
    }

    for (const url of urls) {
      if (imagesRef.current.has(url)) continue
      const image = new Image()
      image.decoding = 'async'
      image.src = url
      imagesRef.current.set(url, image)
      void image.decode().catch(() => undefined)
    }
  }, [activeIndex, slides])

  useEffect(() => () => {
    for (const image of imagesRef.current.values()) image.removeAttribute('src')
    imagesRef.current.clear()
  }, [])
}
