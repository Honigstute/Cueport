import { useEffect } from 'react'
import type { SlideAsset } from '../types'
import { sharedImagePreloadCache } from '../lib/imagePreloadCache'
import { adjacentMediaPreloadUrls } from '../lib/mediaPreload'

/**
 * Decode the current still and its immediate neighbors before navigation.
 * The shared cache keeps a small recent working set, so revisiting a slide does
 * not immediately repeat expensive 4K decoding after this hook remounts.
 */
export function useAdjacentMediaPreload(slides: SlideAsset[], activeIndex: number): void {
  useEffect(() => {
    const urls = adjacentMediaPreloadUrls(slides, activeIndex)
    for (const url of urls) void sharedImagePreloadCache.preload(url)
  }, [activeIndex, slides])
}
