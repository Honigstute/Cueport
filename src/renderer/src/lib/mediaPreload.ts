import type { SlideAsset } from '../types'

/** Keep only the current slide and its immediate neighbors decoded. */
export function adjacentMediaPreloadUrls(slides: SlideAsset[], activeIndex: number): string[] {
  if (activeIndex < 0 || activeIndex >= slides.length) return []
  const urls = [activeIndex, activeIndex - 1, activeIndex + 1]
    .map((index) => slides[index])
    .filter((slide): slide is SlideAsset => Boolean(slide))
    .map((slide) => slide.mimeType === 'video/mp4' ? slide.thumbnailUrl : slide.url)
    .filter(Boolean)
  return [...new Set(urls)]
}
