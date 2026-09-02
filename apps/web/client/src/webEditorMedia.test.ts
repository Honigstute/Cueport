import { beforeEach, describe, expect, it, vi } from 'vitest'

const createSlideAsset = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/renderer/src/lib/assets', () => ({
  createLogoAsset: vi.fn(),
  createSlideAsset
}))

import { importWebMedia } from './webEditorMedia'

function transparentPng(bytes: number): File {
  const header = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
    0, 0, 0, 0
  ])
  return new File([header, new Uint8Array(bytes - header.length)], 'transparent.png', { type: 'image/png' })
}

describe('web editor media import', () => {
  beforeEach(() => {
    createSlideAsset.mockReset()
  })

  it('persists a lightweight poster for an imported image', async () => {
    createSlideAsset.mockResolvedValue({
      id: 'image-1',
      name: 'layout.png',
      url: 'blob:layout',
      thumbnailUrl: 'data:image/jpeg;base64,cHJldmlldw==',
      width: 3840,
      height: 2160,
      mimeType: 'image/png',
      origin: 'local',
      sourceKey: null
    })
    const source = new File([new Uint8Array([137, 80, 78, 71])], 'layout.png', { type: 'image/png' })

    const imported = await importWebMedia(source, 'slides')

    expect(imported.assetKey).toBe('slides/image-1.png')
    expect(imported.posterKey).toBe('thumbnails/image-1.jpg')
    expect(imported.asset.sourceKey).toBe('slides/image-1.png')
    expect(imported.pending.map(([key]) => key)).toEqual([
      'slides/image-1.png',
      'thumbnails/image-1.jpg'
    ])
    expect(imported.pending[0][1].blob).toBe(source)
    expect(imported.pending[1][1]).toMatchObject({ mimeType: 'image/jpeg' })
  })

  it('keeps a large transparent PNG as the original source format', async () => {
    createSlideAsset.mockResolvedValue({
      id: 'transparent-1',
      name: 'transparent.png',
      url: 'blob:transparent',
      thumbnailUrl: 'data:image/jpeg;base64,cHJldmlldw==',
      width: 2048,
      height: 2048,
      mimeType: 'image/png',
      origin: 'local',
      sourceKey: null
    })
    const source = transparentPng(8 * 1024 * 1024)

    const imported = await importWebMedia(source, 'references')

    expect(createSlideAsset).toHaveBeenCalledWith(source)
    expect(imported.assetKey).toBe('references/transparent-1.png')
    expect(imported.pending[0][1]).toMatchObject({ blob: source, mimeType: 'image/png' })
  })
})
