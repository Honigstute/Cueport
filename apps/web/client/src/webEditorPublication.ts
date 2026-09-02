import type { PresentationDocument, PresentationAssetMimeType, PresentationMediaMimeType } from '../../../../src/shared/presentation'
import { PRESENTATION_DOCUMENT_VERSION } from '../../../../src/shared/presentation'
import { PUBLICATION_PREVIEW_ASSET_KEY } from '../../../../src/shared/projects'
import { toStoredSettings } from '../../../../src/renderer/src/state/presentationReducer'
import type { PresentationState } from '../../../../src/renderer/src/types'
import { api, ApiRequestError } from './api'

export interface PublishedEditorAsset {
  key: string
  url: string
  mimeType: string
  bytes: number
  sha256: string | null
}

export interface PendingEditorAsset {
  blob: Blob
  mimeType: PresentationMediaMimeType | PresentationAssetMimeType
}

interface PublicationAssetInput {
  key: string
  mimeType: string
  bytes: number
  sha256: string
}

interface DraftResponse {
  revisionId: string
  reused?: string[]
  uploads: Array<{ key: string; url: string }>
}

export type EditorSavePhase = 'preparing' | 'uploading' | 'finalizing'

function documentMedia(
  media: PresentationState['slides'][number],
  posterKeys: ReadonlyMap<string, string>
): PresentationDocument['slides'][number] {
  if (!media.sourceKey) throw new Error(`${media.name} has no saved web asset.`)
  const posterKey = posterKeys.get(media.id)
  return {
    id: media.id,
    name: media.name,
    width: media.width,
    height: media.height,
    assetKey: media.sourceKey,
    mimeType: media.mimeType,
    ...(posterKey ? { posterKey } : {})
  }
}

/** The portable document stays the single source of truth for desktop and web. */
export function documentFromEditorState(
  state: PresentationState,
  original: PresentationDocument,
  posterKeys: ReadonlyMap<string, string>
): PresentationDocument {
  if (state.slides.length === 0) throw new Error('A presentation needs at least one Sequence item.')
  const now = new Date().toISOString()
  const slides = state.slides.map((media) => documentMedia(media, posterKeys))
  return {
    schemaVersion: PRESENTATION_DOCUMENT_VERSION,
    id: original.id,
    name: original.name,
    createdAt: original.createdAt,
    updatedAt: now,
    activeSlideId: state.activeId && slides.some((slide) => slide.id === state.activeId)
      ? state.activeId
      : slides[0].id,
    settings: toStoredSettings(state),
    slides,
    references: state.references.map((media) => documentMedia(media, posterKeys)),
    brand: state.brand.logoUrl && state.brand.logoName && state.brand.logoSourceKey
      ? {
          name: state.brand.logoName,
          assetKey: state.brand.logoSourceKey,
          mimeType: mimeTypeForKey(state.brand.logoSourceKey) as PresentationAssetMimeType
        }
      : null
  }
}

function mimeTypeForKey(key: string): string {
  const extension = key.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'svg') return 'image/svg+xml'
  if (extension === 'mp4') return 'video/mp4'
  throw new Error(`The web asset ${key} has an unsupported type.`)
}

export function requiredEditorAssets(
  document: PresentationDocument,
  preservePreview: boolean
): Array<{ key: string; mimeType: string }> {
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
    ...(preservePreview ? [{ key: PUBLICATION_PREVIEW_ASSET_KEY, mimeType: 'image/jpeg' }] : [])
  ]
  if (new Set(assets.map((asset) => asset.key)).size !== assets.length) {
    throw new Error('The presentation contains duplicate web assets.')
  }
  return assets
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string } | null
  return new ApiRequestError(response.status, body?.error || fallback)
}

/**
 * Publishes a web edit with content fingerprints. Existing server objects are
 * reused by hash; only newly added or genuinely changed files are uploaded.
 */
export async function saveEditorPresentation(options: {
  baseRevisionId: string
  currentAssets: ReadonlyMap<string, PublishedEditorAsset>
  document: PresentationDocument
  onPhase: (phase: EditorSavePhase) => void
  pendingAssets: ReadonlyMap<string, PendingEditorAsset>
}): Promise<void> {
  options.onPhase('preparing')
  const preservePreview = options.currentAssets.has(PUBLICATION_PREVIEW_ASSET_KEY)
  const required = requiredEditorAssets(options.document, preservePreview)
  const blobs = new Map<string, Blob>()
  const manifest: PublicationAssetInput[] = []

  for (const expected of required) {
    const pending = options.pendingAssets.get(expected.key)
    if (pending) {
      if (pending.mimeType !== expected.mimeType) throw new Error(`${expected.key} has an unexpected file type.`)
      blobs.set(expected.key, pending.blob)
      manifest.push({
        key: expected.key,
        mimeType: expected.mimeType,
        bytes: pending.blob.size,
        sha256: await sha256Blob(pending.blob)
      })
      continue
    }

    const published = options.currentAssets.get(expected.key)
    if (!published || published.mimeType !== expected.mimeType) {
      throw new Error(`${expected.key} is no longer available. Reload the presentation and try again.`)
    }
    if (published.sha256) {
      manifest.push({ key: expected.key, mimeType: expected.mimeType, bytes: published.bytes, sha256: published.sha256 })
      continue
    }

    // Legacy revisions may not have fingerprints yet. Read that one asset once;
    // the server backfills its hash and future saves can reuse it immediately.
    const response = await fetch(published.url, { credentials: 'same-origin' })
    if (!response.ok) throw await responseError(response, `${expected.key} could not be prepared.`)
    const blob = await response.blob()
    blobs.set(expected.key, blob)
    manifest.push({ key: expected.key, mimeType: expected.mimeType, bytes: blob.size, sha256: await sha256Blob(blob) })
  }

  const draft = await api<DraftResponse>('/api/publications/drafts', {
    method: 'POST',
    body: JSON.stringify({
      baseRevisionId: options.baseRevisionId,
      document: options.document,
      assets: manifest
    })
  })

  options.onPhase('uploading')
  for (const upload of draft.uploads) {
    let blob = blobs.get(upload.key)
    if (!blob) {
      const published = options.currentAssets.get(upload.key)
      if (!published) throw new Error(`The server requested an unknown asset: ${upload.key}`)
      const response = await fetch(published.url, { credentials: 'same-origin' })
      if (!response.ok) throw await responseError(response, `${upload.key} could not be read.`)
      blob = await response.blob()
    }
    const expected = manifest.find((asset) => asset.key === upload.key)
    if (!expected) throw new Error(`The server requested an unexpected asset: ${upload.key}`)
    const response = await fetch(upload.url, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': expected.mimeType },
      body: blob
    })
    if (!response.ok) throw await responseError(response, `${upload.key} could not be uploaded.`)
  }

  options.onPhase('finalizing')
  await api(`/api/publications/revisions/${encodeURIComponent(draft.revisionId)}/commit`, {
    method: 'POST',
    body: '{}'
  })
}
