import type { DisplayMode, ViewportSize } from '../types'

export interface DisplayResolution {
  width: number
  height: number
}

interface DisplayResolutionInput {
  sourceWidth: number
  sourceHeight: number
  mode: DisplayMode
  zoom: number
  viewportEnabled: boolean
  viewport: ViewportSize
  fitWidth: number | null
}

/** Reports displayed pixels after the active viewing scale is applied. */
export function calculateDisplayResolution({
  sourceWidth,
  sourceHeight,
  mode,
  zoom,
  viewportEnabled,
  viewport,
  fitWidth
}: DisplayResolutionInput): DisplayResolution {
  if (mode === 'canvas' && viewportEnabled) {
    return {
      width: Math.max(1, Math.round(viewport.width * zoom)),
      height: Math.max(1, Math.round(viewport.height * zoom))
    }
  }

  const scale = mode === 'fit-width' && fitWidth && fitWidth > 0
    ? fitWidth / sourceWidth
    : zoom
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  }
}
