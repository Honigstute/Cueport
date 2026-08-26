export interface ReferenceOverlayRect {
  x: number
  y: number
  width: number
  height: number
}

export type ReferenceResizeCorner = 'north-west' | 'north-east' | 'south-west' | 'south-east'

const OVERLAY_MARGIN = 16
const MIN_OVERLAY_WIDTH = 160
const DEFAULT_OVERLAY_WIDTH = 360

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

/** Creates a useful first size near the context-click without covering the whole stage. */
export function createReferenceOverlayRect(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  anchorX: number,
  anchorY: number
): ReferenceOverlayRect {
  const aspectRatio = Math.max(0.05, sourceWidth / Math.max(1, sourceHeight))
  const maximumWidth = Math.max(1, containerWidth - OVERLAY_MARGIN * 2)
  const maximumHeight = Math.max(1, containerHeight - OVERLAY_MARGIN * 2)
  let width = Math.min(DEFAULT_OVERLAY_WIDTH, containerWidth * 0.36, maximumWidth)
  width = Math.max(Math.min(220, maximumWidth), width)
  let height = width / aspectRatio

  if (height > maximumHeight) {
    height = maximumHeight
    width = height * aspectRatio
  }

  return {
    x: clamp(anchorX - width / 2, OVERLAY_MARGIN, containerWidth - width - OVERLAY_MARGIN),
    y: clamp(anchorY - height / 2, OVERLAY_MARGIN, containerHeight - height - OVERLAY_MARGIN),
    width,
    height
  }
}
export function moveReferenceOverlayRect(
  rect: ReferenceOverlayRect,
  deltaX: number,
  deltaY: number,
  containerWidth: number,
  containerHeight: number
): ReferenceOverlayRect {
  return {
    ...rect,
    x: clamp(rect.x + deltaX, OVERLAY_MARGIN, containerWidth - rect.width - OVERLAY_MARGIN),
    y: clamp(rect.y + deltaY, OVERLAY_MARGIN, containerHeight - rect.height - OVERLAY_MARGIN)
  }
}

/** Resize always preserves the source aspect ratio and keeps the opposite corner fixed. */
export function resizeReferenceOverlayRect(
  rect: ReferenceOverlayRect,
  corner: ReferenceResizeCorner,
  deltaX: number,
  deltaY: number,
  containerWidth: number,
  containerHeight: number
): ReferenceOverlayRect {
  const aspectRatio = rect.width / Math.max(1, rect.height)
  const isWest = corner.endsWith('west')
  const isNorth = corner.startsWith('north')
  const horizontalWidth = rect.width + (isWest ? -deltaX : deltaX)
  const verticalWidth = rect.width + (isNorth ? -deltaY : deltaY) * aspectRatio
  const requestedWidth = Math.abs(horizontalWidth - rect.width) >= Math.abs(verticalWidth - rect.width)
    ? horizontalWidth
    : verticalWidth
  const maximumHorizontalWidth = isWest
    ? rect.x + rect.width - OVERLAY_MARGIN
    : containerWidth - rect.x - OVERLAY_MARGIN
  const maximumVerticalWidth = (
    isNorth
      ? rect.y + rect.height - OVERLAY_MARGIN
      : containerHeight - rect.y - OVERLAY_MARGIN
  ) * aspectRatio
  const maximumWidth = Math.max(1, Math.min(maximumHorizontalWidth, maximumVerticalWidth))
  const minimumWidth = Math.min(MIN_OVERLAY_WIDTH, maximumWidth)
  const width = clamp(requestedWidth, minimumWidth, maximumWidth)
  const height = width / aspectRatio

  return {
    x: isWest ? rect.x + rect.width - width : rect.x,
    y: isNorth ? rect.y + rect.height - height : rect.y,
    width,
    height
  }
}
