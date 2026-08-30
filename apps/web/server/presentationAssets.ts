import type { PresentationDocument } from '../../../src/shared/presentation'

export interface ExpectedPublicationAsset {
  key: string
  mimeType: string
}

/**
 * One portable document is the authority for every uploaded object. The API
 * never accepts extra files that are absent from the immutable revision.
 */
export function collectExpectedAssets(document: PresentationDocument): ExpectedPublicationAsset[] {
  const assets = [
    ...document.slides.flatMap((media) => [
      { key: media.assetKey, mimeType: media.mimeType },
      ...(media.posterKey ? [{ key: media.posterKey, mimeType: 'image/jpeg' }] : [])
    ]),
    ...document.references.flatMap((media) => [
      { key: media.assetKey, mimeType: media.mimeType },
      ...(media.posterKey ? [{ key: media.posterKey, mimeType: 'image/jpeg' }] : [])
    ]),
    ...(document.brand ? [{ key: document.brand.assetKey, mimeType: document.brand.mimeType }] : [])
  ]

  const keys = new Set<string>()
  for (const asset of assets) {
    if (keys.has(asset.key)) throw new Error('The presentation reuses an asset key.')
    keys.add(asset.key)
  }
  return assets
}
