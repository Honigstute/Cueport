export interface NormalizedCommentAnchor {
  x: number
  y: number
}

interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Convert a click on the rendered artwork back into its source-relative point. */
export function commentAnchorFromClientPoint(clientX: number, clientY: number, rect: RectLike): NormalizedCommentAnchor | null {
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)) return null
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: clamp((clientX - rect.left) / rect.width),
    y: clamp((clientY - rect.top) / rect.height)
  }
}

/** Move a saved artwork-relative point by a rendered pointer delta. */
export function moveCommentAnchor(
  anchor: NormalizedCommentAnchor,
  deltaX: number,
  deltaY: number,
  rect: Pick<RectLike, 'width' | 'height'>
): NormalizedCommentAnchor | null {
  if (![anchor.x, anchor.y, deltaX, deltaY, rect.width, rect.height].every(Number.isFinite)) return null
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: clamp(anchor.x + deltaX / rect.width),
    y: clamp(anchor.y + deltaY / rect.height)
  }
}
