import { useCallback, useEffect, useRef, useState } from 'react'

const DRAG_THRESHOLD = 5
const MAX_HORIZONTAL_VELOCITY = 3.2
const MAX_VERTICAL_VELOCITY = 4
const HORIZONTAL_MOMENTUM_FRICTION = 0.9
const VERTICAL_MOMENTUM_FRICTION = 0.94
const MOMENTUM_STOP_VELOCITY = 0.02
const NAVIGATION_AXIS_RATIO = 1.35
const NAVIGATION_THRESHOLD_RATIO = 0.08
const NAVIGATION_THRESHOLD_MIN = 72
const NAVIGATION_THRESHOLD_MAX = 96
const NAVIGATION_PREVIEW_DAMPING = 0.2
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [contenteditable="true"], [data-no-pan]'

export type SlideNavigationDirection = -1 | 1

export interface SlideSwipePreview {
  armed: boolean
  direction: SlideNavigationDirection | null
}

const IDLE_SWIPE_PREVIEW: SlideSwipePreview = { armed: false, direction: null }

interface DragNavigation {
  canNavigateNext: boolean
  canNavigatePrevious: boolean
  onNavigate: (direction: SlideNavigationDirection) => void
}

interface DragOrigin {
  pointerId: number
  x: number
  y: number
  lastX: number
  lastY: number
  lastTime: number
  scrollLeft: number
  scrollTop: number
  velocityX: number
  velocityY: number
  navigationDirection: SlideNavigationDirection | null
  navigationDistance: number
  navigationThreshold: number
  previewArmed: boolean
  previewDirection: SlideNavigationDirection | null
  committed: boolean
  hasCapture: boolean
  horizontalScroller: HTMLDivElement
  verticalScroller: HTMLDivElement
  scroller: HTMLDivElement
}

interface DragScrollTargets {
  horizontal?: HTMLDivElement | null
  vertical?: HTMLDivElement | null
}

type ResolveDragScrollTargets = (source: HTMLDivElement) => DragScrollTargets

interface ClickDragScroll {
  isDragging: boolean
  swipePreview: SlideSwipePreview
  onPointerDown: React.PointerEventHandler<HTMLDivElement>
  onClickCapture: React.MouseEventHandler<HTMLDivElement>
  onWheel: React.WheelEventHandler<HTMLDivElement>
  cancelMomentum: () => void
}

function pointerTime(event: { timeStamp: number }): number {
  return Number.isFinite(event.timeStamp) && event.timeStamp > 0 ? event.timeStamp : performance.now()
}

function clampVelocity(velocity: number, maximum: number): number {
  return Math.max(-maximum, Math.min(maximum, velocity))
}

function navigationThreshold(viewportWidth: number): number {
  return Math.max(
    NAVIGATION_THRESHOLD_MIN,
    Math.min(NAVIGATION_THRESHOLD_MAX, viewportWidth * NAVIGATION_THRESHOLD_RATIO)
  )
}

function resolveNavigationOverswipe(
  origin: DragOrigin,
  deltaX: number,
  deltaY: number,
  navigation: DragNavigation | undefined
): { direction: SlideNavigationDirection; distance: number } | null {
  if (!navigation || Math.abs(deltaX) < Math.abs(deltaY) * NAVIGATION_AXIS_RATIO) return null

  const maximumScrollLeft = Math.max(
    0,
    origin.horizontalScroller.scrollWidth - origin.horizontalScroller.clientWidth
  )
  const requestedScrollLeft = origin.scrollLeft - deltaX
  if (requestedScrollLeft < 0 && navigation.canNavigatePrevious) {
    return { direction: -1, distance: -requestedScrollLeft }
  }
  if (requestedScrollLeft > maximumScrollLeft && navigation.canNavigateNext) {
    return { direction: 1, distance: requestedScrollLeft - maximumScrollLeft }
  }
  return null
}

/**
 * The pointer must travel far enough to make navigation deliberate, while the
 * canvas moves at one fifth of that distance so the gesture reads as resistance
 * without visually tracking the pointer one-to-one.
 */
function updateNavigationPreview(
  origin: DragOrigin,
  overswipe: { direction: SlideNavigationDirection; distance: number } | null,
  setSwipePreview: (preview: SlideSwipePreview) => void
): void {
  const direction = overswipe?.direction ?? null
  const armed = Boolean(overswipe && overswipe.distance >= origin.navigationThreshold)

  if (overswipe) {
    const offset = -overswipe.direction * overswipe.distance * NAVIGATION_PREVIEW_DAMPING
    origin.scroller.dataset.swipeActive = 'true'
    origin.scroller.style.setProperty('--slide-drag-offset', `${offset}px`)
  } else {
    delete origin.scroller.dataset.swipeActive
    origin.scroller.style.removeProperty('--slide-drag-offset')
  }

  if (origin.previewDirection === direction && origin.previewArmed === armed) return
  origin.previewDirection = direction
  origin.previewArmed = armed
  setSwipePreview({ armed, direction })
}

function clearNavigationPreview(origin: DragOrigin): void {
  delete origin.scroller.dataset.swipeActive
  origin.scroller.style.removeProperty('--slide-drag-offset')
  origin.previewDirection = null
  origin.previewArmed = false
}

/**
 * Adds mouse panning with native-style momentum without replacing touch, wheel,
 * trackpad, or keyboard scrolling. Every pannable canvas uses this one engine.
 */
export function useClickDragScroll(
  resetKey: string,
  navigation?: DragNavigation,
  resolveScrollTargets?: ResolveDragScrollTargets
): ClickDragScroll {
  const originRef = useRef<DragOrigin | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const momentumFrameRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef<number | null>(null)
  const pointerEndSuppressionCleanupRef = useRef<(() => void) | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [swipePreview, setSwipePreview] = useState<SlideSwipePreview>(IDLE_SWIPE_PREVIEW)

  const cancelMomentum = useCallback((): void => {
    if (momentumFrameRef.current === null) return
    window.cancelAnimationFrame(momentumFrameRef.current)
    momentumFrameRef.current = null
  }, [])

  const startMomentum = useCallback((
    horizontalScroller: HTMLDivElement,
    verticalScroller: HTMLDivElement,
    initialVelocityX: number,
    initialVelocityY: number
  ): void => {
    cancelMomentum()
    let velocityX = initialVelocityX
    let velocityY = initialVelocityY
    if (Math.hypot(velocityX, velocityY) < MOMENTUM_STOP_VELOCITY) return

    let previousTime = performance.now()
    const advance = (time: number): void => {
      const elapsed = Math.min(32, Math.max(1, time - previousTime))
      previousTime = time
      velocityX *= Math.pow(HORIZONTAL_MOMENTUM_FRICTION, elapsed / 16.67)
      velocityY *= Math.pow(VERTICAL_MOMENTUM_FRICTION, elapsed / 16.67)

      const previousLeft = horizontalScroller.scrollLeft
      const previousTop = verticalScroller.scrollTop
      horizontalScroller.scrollLeft += velocityX * elapsed
      verticalScroller.scrollTop += velocityY * elapsed

      // Browsers clamp scrolling at each edge. Stop that velocity component as
      // soon as clamping prevents movement instead of burning idle animation frames.
      if (Math.abs(horizontalScroller.scrollLeft - previousLeft) < 0.01) velocityX = 0
      if (Math.abs(verticalScroller.scrollTop - previousTop) < 0.01) velocityY = 0

      if (Math.hypot(velocityX, velocityY) < MOMENTUM_STOP_VELOCITY) {
        momentumFrameRef.current = null
        return
      }
      momentumFrameRef.current = window.requestAnimationFrame(advance)
    }

    momentumFrameRef.current = window.requestAnimationFrame(advance)
  }, [cancelMomentum])

  const stopTracking = useCallback((suppressClick: boolean, startGlide = false): void => {
    const origin = originRef.current
    if (origin?.hasCapture) {
      try {
        if (origin.scroller.hasPointerCapture(origin.pointerId)) {
          origin.scroller.releasePointerCapture(origin.pointerId)
        }
      } catch {
        // The browser can release capture itself during pointerup/cancel.
      }
    }
    cleanupRef.current?.()
    cleanupRef.current = null
    originRef.current = null
    setIsDragging(false)
    if (origin && origin.previewDirection !== null) {
      clearNavigationPreview(origin)
      setSwipePreview(IDLE_SWIPE_PREVIEW)
    }

    if (startGlide && origin) {
      startMomentum(
        origin.horizontalScroller,
        origin.verticalScroller,
        origin.velocityX,
        origin.velocityY
      )
    }

    if (!suppressClick) return
    suppressClickRef.current = true
    if (suppressTimerRef.current) window.clearTimeout(suppressTimerRef.current)
    // Pointer-generated click fires after pointerup in the same task. Clear the
    // guard immediately afterward so the next deliberate click is never lost.
    suppressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false
      suppressTimerRef.current = null
    }, 0)
  }, [startMomentum])

  const suppressClickUntilPointerEnds = useCallback((pointerId: number): void => {
    suppressClickRef.current = true
    if (suppressTimerRef.current) {
      window.clearTimeout(suppressTimerRef.current)
      suppressTimerRef.current = null
    }
    pointerEndSuppressionCleanupRef.current?.()

    const finish = (event?: PointerEvent): void => {
      if (event && event.pointerId !== pointerId) return
      pointerEndSuppressionCleanupRef.current?.()
      pointerEndSuppressionCleanupRef.current = null
      // Keep the guard through Chromium's trailing click, then release it in
      // the next task when the pointer sequence produced no click.
      suppressTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressTimerRef.current = null
      }, 0)
    }

    const handlePointerEnd = (event: PointerEvent): void => finish(event)
    const handleWindowBlur = (): void => finish()
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('blur', handleWindowBlur)
    pointerEndSuppressionCleanupRef.current = () => {
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [])

  const onPointerDown = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    if (
      event.pointerType !== 'mouse' ||
      !event.isPrimary ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      (event.target instanceof HTMLElement && event.target.closest(INTERACTIVE_SELECTOR))
    ) return

    stopTracking(false)
    cancelMomentum()
    const scroller = event.currentTarget
    const resolvedTargets = resolveScrollTargets?.(scroller)
    const horizontalScroller = resolvedTargets?.horizontal ?? scroller
    const verticalScroller = resolvedTargets?.vertical ?? scroller
    const canPan = horizontalScroller.scrollWidth > horizontalScroller.clientWidth ||
      verticalScroller.scrollHeight > verticalScroller.clientHeight
    const canNavigate = Boolean(navigation?.canNavigatePrevious || navigation?.canNavigateNext)
    if (!canPan && !canNavigate) return
    originRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: pointerTime(event),
      scrollLeft: horizontalScroller.scrollLeft,
      scrollTop: verticalScroller.scrollTop,
      velocityX: 0,
      velocityY: 0,
      navigationDirection: null,
      navigationDistance: 0,
      navigationThreshold: navigationThreshold(scroller.clientWidth),
      previewArmed: false,
      previewDirection: null,
      committed: false,
      hasCapture: false,
      horizontalScroller,
      verticalScroller,
      scroller
    }

    const handlePointerMove = (pointerEvent: PointerEvent): void => {
      const origin = originRef.current
      if (!origin || pointerEvent.pointerId !== origin.pointerId) return
      if ((pointerEvent.buttons & 1) === 0) {
        stopTracking(origin.committed, origin.committed && origin.navigationDirection === null)
        return
      }

      const deltaX = pointerEvent.clientX - origin.x
      const deltaY = pointerEvent.clientY - origin.y
      if (!origin.committed && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return

      if (!origin.committed) {
        origin.committed = true
        try {
          origin.scroller.setPointerCapture(origin.pointerId)
          origin.hasCapture = true
        } catch {
          // Window listeners remain as a fallback when capture is unavailable.
        }
        setIsDragging(true)
      }

      const canScrollX = origin.horizontalScroller.scrollWidth > origin.horizontalScroller.clientWidth
      const canScrollY = origin.verticalScroller.scrollHeight > origin.verticalScroller.clientHeight
      const navigationOverswipe = resolveNavigationOverswipe(origin, deltaX, deltaY, navigation)
      origin.navigationDirection = navigationOverswipe?.direction ?? null
      origin.navigationDistance = navigationOverswipe?.distance ?? 0
      updateNavigationPreview(origin, navigationOverswipe, setSwipePreview)

      // Crossing the visible threshold is the commitment. Navigate while the
      // pointer is still held so the confirmation pill and next frame begin
      // together, with no second release gate that can appear to snap back.
      if (navigationOverswipe && navigationOverswipe.distance >= origin.navigationThreshold) {
        pointerEvent.preventDefault()
        suppressClickUntilPointerEnds(origin.pointerId)
        const direction = navigationOverswipe.direction
        navigation?.onNavigate(direction)
        stopTracking(false)
        return
      }
      if (!canScrollX && !canScrollY && !navigationOverswipe) return

      pointerEvent.preventDefault()
      if (canScrollX) {
        const maximumScrollLeft = Math.max(
          0,
          origin.horizontalScroller.scrollWidth - origin.horizontalScroller.clientWidth
        )
        origin.horizontalScroller.scrollLeft = Math.max(
          0,
          Math.min(maximumScrollLeft, origin.scrollLeft - deltaX)
        )
      }
      if (canScrollY) origin.verticalScroller.scrollTop = origin.scrollTop - deltaY

      const time = pointerTime(pointerEvent)
      const elapsed = Math.max(1, time - origin.lastTime)
      const nextVelocityX = canScrollX ? -(pointerEvent.clientX - origin.lastX) / elapsed : 0
      const nextVelocityY = canScrollY ? -(pointerEvent.clientY - origin.lastY) / elapsed : 0
      origin.velocityX = clampVelocity(origin.velocityX * 0.45 + nextVelocityX * 0.55, MAX_HORIZONTAL_VELOCITY)
      origin.velocityY = clampVelocity(origin.velocityY * 0.45 + nextVelocityY * 0.55, MAX_VERTICAL_VELOCITY)
      origin.lastX = pointerEvent.clientX
      origin.lastY = pointerEvent.clientY
      origin.lastTime = time
    }

    const handlePointerUp = (pointerEvent: PointerEvent): void => {
      const origin = originRef.current
      if (!origin || pointerEvent.pointerId !== origin.pointerId) return
      const navigationDirection = origin.navigationDistance >= origin.navigationThreshold
        ? origin.navigationDirection
        : null
      const hadNavigationPreview = origin.navigationDirection !== null
      const idleTime = pointerTime(pointerEvent) - origin.lastTime
      if (idleTime > 80) {
        const releaseFactor = Math.max(0, 1 - (idleTime - 80) / 120)
        origin.velocityX *= releaseFactor
        origin.velocityY *= releaseFactor
      }
      // A cancelled slide gesture settles back to zero instead of inheriting
      // horizontal momentum, which would make the threshold feel unpredictable.
      stopTracking(
        origin.committed,
        origin.committed && navigationDirection === null && !hadNavigationPreview
      )
      if (navigationDirection !== null) navigation?.onNavigate(navigationDirection)
    }

    const handlePointerCancel = (pointerEvent: PointerEvent): void => {
      const origin = originRef.current
      if (!origin || pointerEvent.pointerId !== origin.pointerId) return
      stopTracking(origin.committed)
    }

    const handleWindowBlur = (): void => stopTracking(originRef.current?.committed ?? false)

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('blur', handleWindowBlur)
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [cancelMomentum, navigation, resolveScrollTargets, stopTracking, suppressClickUntilPointerEnds])

  const onClickCapture = useCallback<React.MouseEventHandler<HTMLDivElement>>((event) => {
    if (!suppressClickRef.current || event.detail === 0) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const onWheel = useCallback<React.WheelEventHandler<HTMLDivElement>>(() => {
    cancelMomentum()
  }, [cancelMomentum])

  useEffect(() => {
    stopTracking(false)
    cancelMomentum()
    // Do not clear click suppression when a swipe replaces the active slide.
    // Chromium emits the pointer-generated click after the new slide mounts;
    // keeping the guard alive prevents that click from hiding application chrome.
    setSwipePreview(IDLE_SWIPE_PREVIEW)
  }, [cancelMomentum, resetKey, stopTracking])

  useEffect(() => () => {
    cleanupRef.current?.()
    pointerEndSuppressionCleanupRef.current?.()
    cancelMomentum()
    if (suppressTimerRef.current) window.clearTimeout(suppressTimerRef.current)
  }, [cancelMomentum])

  return { isDragging, swipePreview, onPointerDown, onClickCapture, onWheel, cancelMomentum }
}
