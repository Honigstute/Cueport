/**
 * Free mode moves between deliberate presentation scales. The image animates
 * between these stops, so wheel input stays predictable without feeling jumpy.
 */
export const ZOOM_STOPS = [
  0.1,
  0.15,
  0.2,
  0.25,
  0.3,
  0.4,
  0.5,
  0.6,
  0.75,
  0.9,
  1,
  1.25,
  1.5,
  1.75,
  2,
  3,
  4
] as const

export type ZoomDirection = -1 | 1

export function zoomDirectionFromWheel(deltaY: number, deltaX = 0): ZoomDirection | null {
  const delta = deltaY !== 0 ? deltaY : deltaX
  if (!Number.isFinite(delta) || delta === 0) return null
  return delta < 0 ? 1 : -1
}

export function nextZoomStop(current: number, direction: ZoomDirection): number {
  const epsilon = 0.0001
  if (direction > 0) {
    return ZOOM_STOPS.find((stop) => stop > current + epsilon) ?? ZOOM_STOPS[ZOOM_STOPS.length - 1]
  }

  return [...ZOOM_STOPS].reverse().find((stop) => stop < current - epsilon) ?? ZOOM_STOPS[0]
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}
