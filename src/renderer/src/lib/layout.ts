/**
 * Returns the scale that makes content as large as possible while keeping it
 * fully inside the available area. Values above 1 intentionally upscale: a
 * presentation preview should use the screen instead of preserving CSS pixels.
 */
export function calculateContainScale(
  availableWidth: number,
  availableHeight: number,
  contentWidth: number,
  contentHeight: number
): number {
  const dimensions = [availableWidth, availableHeight, contentWidth, contentHeight]
  if (dimensions.some((dimension) => !Number.isFinite(dimension) || dimension <= 0)) return 0

  return Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
}

/**
 * Canvas gutters help smaller artwork read as an object on a surface. Once the
 * scaled image reaches the viewing width, those gutters only create unwanted
 * horizontal overflow, so the artwork becomes edge-to-edge instead.
 */
export function shouldUseEdgeToEdgeCanvas(viewingWidth: number, scaledImageWidth: number): boolean {
  if (!Number.isFinite(viewingWidth) || !Number.isFinite(scaledImageWidth)) return false
  if (viewingWidth <= 0 || scaledImageWidth <= 0) return false
  return scaledImageWidth >= viewingWidth
}
