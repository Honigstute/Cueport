import type { SlideAsset } from '../types'

export function createDemoSlide(): SlideAsset {
  const url = `${import.meta.env.BASE_URL}demo-site.svg`
  return {
    id: crypto.randomUUID(),
    name: 'Northline — Homepage.jpg',
    url,
    thumbnailUrl: url,
    width: 1440,
    height: 2600,
    mimeType: 'image/jpeg',
    origin: 'demo',
    sourceKey: null
  }
}
