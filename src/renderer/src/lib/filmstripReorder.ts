export type FilmstripDropEdge = 'before' | 'after'

/**
 * Resolves the final deck index after removing the dragged card first. Keeping
 * this index math outside the component makes every hover state predictable.
 */
export function resolveFilmstripDestination(
  sourceIndex: number,
  targetIndex: number,
  edge: FilmstripDropEdge,
  itemCount: number
): number {
  if (
    itemCount < 1 ||
    sourceIndex < 0 || sourceIndex >= itemCount ||
    targetIndex < 0 || targetIndex >= itemCount ||
    sourceIndex === targetIndex
  ) return sourceIndex

  const targetAfterRemoval = targetIndex - (sourceIndex < targetIndex ? 1 : 0)
  const insertionIndex = targetAfterRemoval + (edge === 'after' ? 1 : 0)
  return Math.min(itemCount - 1, Math.max(0, insertionIndex))
}

/** Returns the vertical preview shift that opens a real gap at the destination. */
export function resolveFilmstripPreviewShift(
  itemIndex: number,
  sourceIndex: number,
  destinationIndex: number,
  cardStep: number
): number {
  if (sourceIndex < destinationIndex && itemIndex > sourceIndex && itemIndex <= destinationIndex) {
    return -cardStep
  }
  if (sourceIndex > destinationIndex && itemIndex >= destinationIndex && itemIndex < sourceIndex) {
    return cardStep
  }
  return 0
}
