import type { PresentationDocument } from '../../../src/shared/presentation'
import { PUBLICATION_PREVIEW_ASSET_KEY } from '../../../src/shared/projects'

export interface ExpectedPublicationAsset {
  key: string
  mimeType: string
}

/**
 * One portable document is the authority for every uploaded object. The API
 * never accepts extra files that are absent from the immutable revision.
 */
export function collectExpectedAssets(document: PresentationDocument, includePreview = false): ExpectedPublicationAsset[] {
  const assets = [
    ...document.slides.flatMap((media) => [
      { key: media.assetKey, mimeType: media.mimeType },
      ...(media.posterKey ? [{ key: media.posterKey, mimeType: 'image/jpeg' }] : [])
    ]),
    ...document.references.flatMap((media) => [
      { key: media.assetKey, mimeType: media.mimeType },
      ...(media.posterKey ? [{ key: media.posterKey, mimeType: 'image/jpeg' }] : [])
    ]),
    ...(document.brand ? [{ key: document.brand.assetKey, mimeType: document.brand.mimeType }] : []),
    ...(includePreview ? [{ key: PUBLICATION_PREVIEW_ASSET_KEY, mimeType: 'image/jpeg' }] : [])
  ]

  const keys = new Set<string>()
  for (const asset of assets) {
    if (keys.has(asset.key)) throw new Error('The presentation reuses an asset key.')
    keys.add(asset.key)
  }
  return assets
}

/** Exact desktop preview wins; older revisions fall back to useful media. */
export function preferredDashboardThumbnailKeys(document: PresentationDocument): string[] {
  const firstSlide = document.slides[0]
  return [
    PUBLICATION_PREVIEW_ASSET_KEY,
    document.brand?.assetKey,
    firstSlide?.posterKey,
    firstSlide?.mimeType.startsWith('image/') ? firstSlide.assetKey : undefined
  ].filter((key, index, keys): key is string => Boolean(key) && keys.indexOf(key) === index)
}

export function normalizePresentationName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a presentation name.')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name || /[\u0000-\u001F]/.test(name) || Buffer.byteLength(name, 'utf8') > 120) {
    throw new Error('Use a presentation name shorter than 120 characters.')
  }
  return name
}
