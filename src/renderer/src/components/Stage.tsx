import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useClickDragScroll, type SlideNavigationDirection } from '../hooks/useClickDragScroll'
import { getReadableInk } from '../lib/colors'
import { shouldUseEdgeToEdgeCanvas } from '../lib/layout'
import { calculatePhoneFrameGeometry } from '../lib/phoneFrame'
import { nextZoomStop, zoomDirectionFromWheel } from '../lib/zoom'
import type { BrandSettings, CanvasFrame, ChromeMode, DisplayMode, PhoneBrowserBarsSettings, ReferenceAsset, SlideAsset, ViewportSize } from '../types'
import { EmptyState } from './EmptyState'
import { Icon } from './Icon'
import { ReferenceOverlayLayer, type ReferenceOverlayLayerHandle } from './ReferenceOverlayLayer'

interface StageProps {
  slide: SlideAsset | null
  references: ReferenceAsset[]
  mode: DisplayMode
  background: string
  viewport: ViewportSize
  viewportMarker: number | null
  viewportEnabled: boolean
  canvasStartAtTop: boolean
  canvasRoundedCorners: boolean
  canvasImageGlow: boolean
  referenceImageShadow: boolean
  canvasFrame: CanvasFrame
  programBarColor: string
  phoneBrowserBars: PhoneBrowserBarsSettings
  zoom: number
  chromeMode: ChromeMode
  brand: BrandSettings
  isImporting: boolean
  canNavigateNext: boolean
  canNavigatePrevious: boolean
  onChooseMedia: () => void
  onNavigate: (direction: SlideNavigationDirection) => void
  onZoomChange: (zoom: number) => void
  onFitWidthChange: (slideId: string, width: number) => void
  /** Optional web collaboration UI rendered in source-artwork coordinates. */
  artworkOverlay?: React.ReactNode
  /** Optional web action; its presence adds Create comment to the artwork menu. */
  onCreateCommentAt?: (clientX: number, clientY: number) => void
}

const MODE_LABELS: Record<DisplayMode, string> = {
  'fit-width': 'Fit width',
  canvas: 'Canvas'
}

const FREE_WHEEL_INTERVAL = 80
const ZOOM_ANCHOR_DURATION = 240
const WINDOW_BAR_HEIGHT = 30

type VisibleCanvasFrame = Exclude<CanvasFrame, 'none'>

interface ArtworkMenuPoint {
  canCreateComment: boolean
  x: number
  y: number
}

function ArtworkContextMenu({ onClose, onCreateComment, onPlaceReference, x, y }: {
  onClose: () => void
  onCreateComment?: () => void
  onPlaceReference: () => void
  x: number
  y: number
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const actionCount = onCreateComment ? 2 : 1
  const left = Math.max(8, Math.min(x, window.innerWidth - 196))
  const top = Math.max(8, Math.min(y, window.innerHeight - (actionCount * 40 + 8)))

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) onClose()
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  return createPortal(
    <div className="artwork-context-menu slide-context-menu" ref={menuRef} role="menu" style={{ left, top }}>
      {onCreateComment && <button onClick={onCreateComment} role="menuitem" type="button"><Icon name="comment" size={15} /><span>Create Comment</span></button>}
      <button onClick={onPlaceReference} role="menuitem" type="button"><Icon name="image" size={15} /><span>Place Reference</span></button>
    </div>,
    document.body
  )
}

function ArtworkMedia({ slide, style }: { slide: SlideAsset; style?: React.CSSProperties }): React.JSX.Element {
  const mediaKey = `${slide.id}:${slide.url}`
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const isReady = readyKey === mediaKey
  const hasFailed = failedKey === mediaKey
  const loadingState = hasFailed ? 'error' : 'loading'

  const markImageReady = (image: HTMLImageElement): void => {
    const finish = (): void => {
      setFailedKey((current) => current === mediaKey ? null : current)
      setReadyKey(mediaKey)
    }
    if (typeof image.decode !== 'function') {
      finish()
      return
    }
    void image.decode().then(finish, finish)
  }

  const loadingIndicator = !isReady ? (
    <span
      aria-live="polite"
      className="artwork-media-loading"
      data-status={loadingState}
      role="status"
    >
      {hasFailed ? 'Media could not be loaded' : <span aria-hidden="true" />}
    </span>
  ) : null

  if (slide.mimeType === 'video/mp4') {
    return (
      <>
        {loadingIndicator}
        <video
          aria-label={slide.name}
          className="artwork-media"
          controls
          data-ready={isReady}
          draggable={false}
          height={slide.height}
          key={mediaKey}
          loop
          onError={() => setFailedKey(mediaKey)}
          onLoadedData={() => {
            setFailedKey((current) => current === mediaKey ? null : current)
            setReadyKey(mediaKey)
          }}
          playsInline
          poster={slide.thumbnailUrl || undefined}
          preload="metadata"
          src={slide.url}
          style={style}
          width={slide.width}
        />
      </>
    )
  }

  return (
    <>
      {loadingIndicator}
      <img
        alt={slide.name}
        className="artwork-media"
        data-ready={isReady}
        decoding="async"
        draggable={false}
        fetchPriority="high"
        height={slide.height}
        key={mediaKey}
        onError={() => setFailedKey(mediaKey)}
        onLoad={(event) => markImageReady(event.currentTarget)}
        src={slide.url}
        style={style}
        width={slide.width}
      />
    </>
  )
}

/**
 * Frame chrome is deliberately rendered outside the viewport scroller. The
 * imported image moves behind this layer, exactly like content inside a real
 * desktop or phone window.
 */
function CanvasFrameTop({ frame }: { frame: VisibleCanvasFrame }): React.JSX.Element | null {
  // The phone is represented only by its thicker shell. A notch or island
  // would cover the imported design and is deliberately omitted.
  if (frame === 'phone') return null

  return (
    <div aria-hidden="true" className={`artwork-window-top artwork-window-top-${frame}`}>
      {frame === 'mac' && (
        <span className="artwork-window-mac-controls">
          <i /><i /><i />
        </span>
      )}
      {frame === 'windows' && (
        <span className="artwork-window-windows-controls">
          <i className="window-minimize" />
          <i className="window-maximize" />
          <i className="window-close" />
        </span>
      )}
    </div>
  )
}

function CanvasFrameBottom({ frame }: { frame: VisibleCanvasFrame }): React.JSX.Element | null {
  // Phone screenshots end directly at the content edge. Desktop frames keep
  // symmetrical top and bottom bars to read as one balanced window shell.
  if (frame === 'phone') return null

  return (
    <div aria-hidden="true" className={`artwork-window-bottom artwork-window-bottom-${frame}`} />
  )
}

function PhoneBrowserBar({ enabled, position }: { enabled: boolean; position: 'top' | 'bottom' }): React.JSX.Element | null {
  if (!enabled) return null
  return <span aria-hidden="true" className={`phone-browser-bar phone-browser-bar-${position}`} />
}

// The key covers layout changes (notably per-mode padding) that do not resize
// the observed border box and therefore do not wake ResizeObserver by themselves.
function useElementContentSize<T extends HTMLElement>(measureKey: string): [
  T | null,
  React.RefCallback<T>,
  { width: number; height: number; viewportWidth: number; viewportHeight: number }
] {
  const [element, setElement] = useState<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 })
  const ref = useCallback<React.RefCallback<T>>((node) => setElement(node), [])

  useLayoutEffect(() => {
    if (!element) return

    const update = (): void => {
      const style = getComputedStyle(element)
      const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
      const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
      setSize({
        width: Math.max(0, element.clientWidth - horizontalPadding),
        height: Math.max(0, element.clientHeight - verticalPadding),
        viewportWidth: element.clientWidth,
        viewportHeight: element.clientHeight
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, measureKey])

  return [element, ref, size]
}

export function Stage({
  slide,
  references,
  mode,
  background,
  viewport,
  viewportMarker,
  viewportEnabled,
  canvasStartAtTop,
  canvasRoundedCorners,
  canvasImageGlow,
  referenceImageShadow,
  canvasFrame,
  programBarColor,
  phoneBrowserBars,
  zoom,
  chromeMode,
  brand,
  isImporting,
  canNavigateNext,
  canNavigatePrevious,
  onChooseMedia,
  onNavigate,
  onZoomChange,
  onFitWidthChange,
  artworkOverlay,
  onCreateCommentAt
}: StageProps): React.JSX.Element {
  const referenceLayerRef = useRef<ReferenceOverlayLayerHandle>(null)
  const [artworkMenu, setArtworkMenu] = useState<ArtworkMenuPoint | null>(null)
  const isViewportActive = mode === 'canvas' && viewportEnabled
  const activeCanvasFrame = mode === 'canvas' ? canvasFrame : 'none'
  const [outerScrollElement, setOuterScrollRef, scrollAreaSize] = useElementContentSize<HTMLDivElement>(
    `${mode}:${isViewportActive}:${canvasStartAtTop}:${canvasRoundedCorners}:${activeCanvasFrame}:${chromeMode}`
  )
  const viewportScrollRef = useRef<HTMLDivElement>(null)
  const commandKeyHeldRef = useRef(false)
  const lastFreeWheelStepRef = useRef(Number.NEGATIVE_INFINITY)
  const zoomAnchorFrameRef = useRef<number | null>(null)
  const dragResetKey = `${slide?.id ?? 'empty'}:${mode}:${isViewportActive}:${viewport.width}:${viewport.height}:${canvasStartAtTop}:${canvasRoundedCorners}:${activeCanvasFrame}:${zoom}`
  const dragNavigation = { canNavigateNext, canNavigatePrevious, onNavigate }
  const outerDrag = useClickDragScroll(`${dragResetKey}:outer`, dragNavigation)
  const resolveViewportScrollTargets = useCallback(() => ({
    horizontal: outerScrollElement,
    vertical: viewportScrollRef.current
  }), [outerScrollElement])
  const viewportDrag = useClickDragScroll(
    `${dragResetKey}:viewport`,
    dragNavigation,
    resolveViewportScrollTargets
  )
  const swipePreview = viewportDrag.swipePreview.direction !== null
    ? viewportDrag.swipePreview
    : outerDrag.swipePreview

  const cancelZoomAnchor = useCallback((): void => {
    if (zoomAnchorFrameRef.current === null) return
    window.cancelAnimationFrame(zoomAnchorFrameRef.current)
    zoomAnchorFrameRef.current = null
  }, [])

  const handleOuterPointerDown = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    // A viewport has two intentional drag layers. Let its inner scroller own
    // pointers inside the frame; the outer canvas only pans from the surround.
    if (isViewportActive && event.target instanceof HTMLElement && event.target.closest('.viewport-frame')) return
    cancelZoomAnchor()
    viewportDrag.cancelMomentum()
    outerDrag.onPointerDown(event)
  }, [cancelZoomAnchor, isViewportActive, outerDrag.onPointerDown, viewportDrag.cancelMomentum])

  const handleViewportPointerDown = useCallback<React.PointerEventHandler<HTMLDivElement>>((event) => {
    cancelZoomAnchor()
    outerDrag.cancelMomentum()
    viewportDrag.onPointerDown(event)
  }, [cancelZoomAnchor, outerDrag.cancelMomentum, viewportDrag.onPointerDown])

  useEffect(() => {
    outerScrollElement?.scrollTo({ top: 0, left: 0 })
    viewportScrollRef.current?.scrollTo({ top: 0, left: 0 })
    setArtworkMenu(null)
  }, [outerScrollElement, slide?.id, mode, isViewportActive, viewport.width, viewport.height])

  useEffect(() => cancelZoomAnchor, [cancelZoomAnchor])

  useEffect(() => {
    cancelZoomAnchor()
  }, [cancelZoomAnchor, isViewportActive, mode, slide?.id])

  // A viewport is a real pixel surface, not a fit-to-window preview. Its
  // configured dimensions therefore follow the same explicit zoom as Canvas.
  const viewportScale = zoom
  const phoneFrame = calculatePhoneFrameGeometry(zoom)
  const viewportFrameWidth = viewport.width * viewportScale + (
    activeCanvasFrame === 'phone' ? phoneFrame.bezel * 2 : 0
  )
  const artworkStyle: React.CSSProperties | undefined = mode === 'canvas' && slide
    ? isViewportActive
      ? { width: '100%', height: 'auto' }
      : { width: slide.width * zoom, height: 'auto' }
    : undefined
  const useEdgeToEdgeCanvas = Boolean(
    mode === 'canvas' &&
    slide &&
    shouldUseEdgeToEdgeCanvas(
      scrollAreaSize.viewportWidth,
      isViewportActive ? viewportFrameWidth : slide.width * zoom
    )
  )

  useEffect(() => {
    if (mode !== 'fit-width' || !slide || scrollAreaSize.width <= 0) return
    onFitWidthChange(slide.id, Math.max(1, Math.round(scrollAreaSize.width)))
  }, [mode, onFitWidthChange, scrollAreaSize.width, slide])

  useEffect(() => {
    if (mode !== 'canvas' || !outerScrollElement) return

    lastFreeWheelStepRef.current = Number.NEGATIVE_INFINITY

    // Keep a key-state fallback because some wheel devices omit the modifier
    // flag even while Command on macOS (or Control elsewhere) is held.
    const handleModifierKey = (event: KeyboardEvent): void => {
      if (event.key === 'Meta' || event.key === 'Control') commandKeyHeldRef.current = event.type === 'keydown'
    }
    const clearModifierKey = (): void => {
      commandKeyHeldRef.current = false
    }

    // Capture at the window boundary before React or a scroll container can
    // consume the gesture. The composed path still limits scaling to the canvas.
    const handleFreeWheel = (event: WheelEvent): void => {
      if (
        (!event.metaKey && !event.ctrlKey && !commandKeyHeldRef.current) ||
        !event.composedPath().includes(outerScrollElement)
      ) return

      const direction = zoomDirectionFromWheel(event.deltaY, event.deltaX)
      if (!direction) return

      event.preventDefault()
      event.stopPropagation()
      outerDrag.cancelMomentum()
      viewportDrag.cancelMomentum()
      const now = performance.now()
      if (now - lastFreeWheelStepRef.current < FREE_WHEEL_INTERVAL) return
      lastFreeWheelStepRef.current = now
      const nextZoom = nextZoomStop(zoom, direction)
      if (nextZoom === zoom) return

      const target = outerScrollElement.querySelector<HTMLElement>(
        isViewportActive ? '.viewport-frame' : '.artwork-card'
      )
      const targetRect = target?.getBoundingClientRect()
      if (!target || !targetRect || targetRect.width <= 0 || targetRect.height <= 0) {
        onZoomChange(nextZoom)
        return
      }

      const cursorX = event.clientX
      const cursorY = event.clientY
      const anchorX = Math.max(0, Math.min(1, (cursorX - targetRect.left) / targetRect.width))
      const anchorY = Math.max(0, Math.min(1, (cursorY - targetRect.top) / targetRect.height))
      const innerViewport = isViewportActive ? viewportScrollRef.current : null
      const innerRect = innerViewport?.getBoundingClientRect()
      const cursorIsInsideViewport = Boolean(
        innerRect &&
        cursorX >= innerRect.left &&
        cursorX <= innerRect.right &&
        cursorY >= innerRect.top &&
        cursorY <= innerRect.bottom
      )
      const initialInnerScale = innerViewport && viewport.width > 0
        ? innerViewport.clientWidth / viewport.width
        : 0
      const logicalInnerY = innerViewport && innerRect && cursorIsInsideViewport && initialInnerScale > 0
        ? (innerViewport.scrollTop + cursorY - innerRect.top) / initialInnerScale
        : null

      cancelZoomAnchor()

      onZoomChange(nextZoom)
      const startedAt = performance.now()
      const maintainCursorAnchor = (): void => {
        if (!target.isConnected || !outerScrollElement.isConnected) {
          zoomAnchorFrameRef.current = null
          return
        }

        const currentRect = target.getBoundingClientRect()
        const horizontalDrift = currentRect.left + currentRect.width * anchorX - cursorX
        const verticalDrift = currentRect.top + currentRect.height * anchorY - cursorY
        outerScrollElement.scrollLeft += horizontalDrift
        outerScrollElement.scrollTop += verticalDrift

        if (innerViewport && logicalInnerY !== null && viewport.width > 0) {
          const currentInnerRect = innerViewport.getBoundingClientRect()
          const currentInnerScale = innerViewport.clientWidth / viewport.width
          const cursorWithinViewport = cursorY - currentInnerRect.top
          innerViewport.scrollTop = logicalInnerY * currentInnerScale - cursorWithinViewport
        }

        if (performance.now() - startedAt < ZOOM_ANCHOR_DURATION) {
          zoomAnchorFrameRef.current = window.requestAnimationFrame(maintainCursorAnchor)
        } else {
          zoomAnchorFrameRef.current = null
        }
      }
      zoomAnchorFrameRef.current = window.requestAnimationFrame(maintainCursorAnchor)
    }

    window.addEventListener('keydown', handleModifierKey, true)
    window.addEventListener('keyup', handleModifierKey, true)
    window.addEventListener('blur', clearModifierKey)
    window.addEventListener('wheel', handleFreeWheel, { capture: true, passive: false })
    return () => {
      clearModifierKey()
      window.removeEventListener('keydown', handleModifierKey, true)
      window.removeEventListener('keyup', handleModifierKey, true)
      window.removeEventListener('blur', clearModifierKey)
      window.removeEventListener('wheel', handleFreeWheel, true)
    }
  }, [cancelZoomAnchor, isViewportActive, mode, onZoomChange, outerDrag.cancelMomentum, outerScrollElement, viewport.width, viewportDrag.cancelMomentum, zoom])

  const artwork = slide ? (
    <div className="artwork-content">
      <ArtworkMedia key={`${slide.id}:${slide.url}`} slide={slide} style={artworkStyle} />
      {artworkOverlay}
    </div>
  ) : null

  const framedArtwork = artwork && activeCanvasFrame !== 'none' ? (
    <div className={`artwork-window artwork-window-${activeCanvasFrame}`}>
      <CanvasFrameTop frame={activeCanvasFrame} />
      {activeCanvasFrame === 'phone' && <PhoneBrowserBar enabled={phoneBrowserBars.enabled} position="top" />}
      {artwork}
      <CanvasFrameBottom frame={activeCanvasFrame} />
      {activeCanvasFrame === 'phone' && <PhoneBrowserBar enabled={phoneBrowserBars.enabled} position="bottom" />}
    </div>
  ) : artwork
  const imageGlow = mode === 'canvas' && canvasImageGlow && slide ? (
    <img
      alt=""
      aria-hidden="true"
      className="canvas-image-glow"
      draggable={false}
      key={`${slide.id}:glow`}
      src={slide.mimeType === 'video/mp4' ? slide.thumbnailUrl : slide.url}
    />
  ) : null

  return (
    <main
      className={`stage stage-${mode}`}
      data-dragging={outerDrag.isDragging || viewportDrag.isDragging}
      data-frame={activeCanvasFrame}
      data-image-glow={mode === 'canvas' && canvasImageGlow}
      data-reference-shadow={referenceImageShadow}
      data-phone-browser-bars={activeCanvasFrame === 'phone' && phoneBrowserBars.enabled}
      data-rounded={mode === 'canvas' && canvasRoundedCorners}
      data-start-at-top={mode === 'canvas' && canvasStartAtTop}
      data-viewport={isViewportActive}
      onContextMenu={(event) => {
        if (!slide || (event.target instanceof Element && event.target.closest('.reference-overlay'))) return
        event.preventDefault()
        const artworkTarget = event.target instanceof Element && Boolean(event.target.closest('.artwork-content'))
        setArtworkMenu({
          canCreateComment: artworkTarget && Boolean(onCreateCommentAt),
          x: event.clientX,
          y: event.clientY
        })
      }}
      style={{
        '--stage-background': background,
        '--program-bar-color': programBarColor,
        '--program-bar-ink': getReadableInk(programBarColor),
        '--phone-bezel': `${phoneFrame.bezel}px`,
        '--phone-browser-bar-height': `${75 * viewportScale}px`,
        '--phone-browser-bar-color': phoneBrowserBars.color,
        '--phone-screen-radius': `${phoneFrame.screenRadius}px`,
        '--phone-shell-radius': `${phoneFrame.shellRadius}px`
      } as React.CSSProperties}
    >
      {!slide ? (
        <EmptyState isImporting={isImporting} onChooseMedia={onChooseMedia} />
      ) : (
        <>
          <div
            className="stage-scroll"
            data-active-scroll={!isViewportActive}
            data-edge-to-edge-x={useEdgeToEdgeCanvas}
            data-grabbable="true"
            onClickCapture={outerDrag.onClickCapture}
            onPointerDown={handleOuterPointerDown}
            onWheel={outerDrag.onWheel}
            ref={setOuterScrollRef}
            tabIndex={!isViewportActive ? 0 : -1}
            aria-label={!isViewportActive ? `${MODE_LABELS[mode]} canvas. Scroll or drag to pan.` : undefined}
          >
            {isViewportActive ? (
              <div
                className={`viewport-frame viewport-frame-${activeCanvasFrame}`}
                data-frame={activeCanvasFrame}
                style={{
                  width: viewport.width * viewportScale,
                  height: viewport.height * viewportScale + (
                    activeCanvasFrame !== 'none' && activeCanvasFrame !== 'phone'
                      ? WINDOW_BAR_HEIGHT * 2
                      : 0
                  )
                }}
              >
                {imageGlow}
                <div className="viewport-frame-surface">
                  {activeCanvasFrame !== 'none' && <CanvasFrameTop frame={activeCanvasFrame} />}
                  {activeCanvasFrame === 'phone' && <PhoneBrowserBar enabled={phoneBrowserBars.enabled} position="top" />}
                  <div
                    className="viewport-scroll"
                    data-active-scroll="true"
                    data-grabbable="true"
                    onClickCapture={viewportDrag.onClickCapture}
                    onPointerDown={handleViewportPointerDown}
                    onWheel={viewportDrag.onWheel}
                    ref={viewportScrollRef}
                    tabIndex={0}
                    aria-label={`${viewport.label} viewport. Scroll or drag to pan the design.`}
                  >
                    {artwork}
                  </div>
                  {activeCanvasFrame !== 'none' && <CanvasFrameBottom frame={activeCanvasFrame} />}
                  {activeCanvasFrame === 'phone' && <PhoneBrowserBar enabled={phoneBrowserBars.enabled} position="bottom" />}
                </div>
                {viewportMarker !== null && (
                  <div
                    aria-hidden="true"
                    className="viewport-marker-overlay"
                    style={{
                      bottom: activeCanvasFrame === 'phone'
                        ? phoneFrame.bezel
                        : activeCanvasFrame !== 'none'
                          ? WINDOW_BAR_HEIGHT
                          : 0,
                      top: viewportMarker * viewportScale + (
                        activeCanvasFrame === 'phone'
                          ? phoneFrame.bezel
                          : activeCanvasFrame !== 'none'
                            ? WINDOW_BAR_HEIGHT
                            : 0
                      )
                    }}
                  />
                )}
              </div>
            ) : (
              <div className="artwork-layout">
                <div className="artwork-card">
                  {imageGlow}
                  <div className="artwork-surface">{framedArtwork}</div>
                </div>
              </div>
            )}
          </div>

          <div aria-live="polite" className="slide-swipe-indicators">
            <div
              aria-hidden={!(swipePreview.armed && swipePreview.direction === -1)}
              className="slide-swipe-indicator slide-swipe-indicator-previous"
              data-armed={swipePreview.armed && swipePreview.direction === -1}
            >
              <Icon name="arrow-left" size={17} />
              <strong>Previous screen</strong>
            </div>
            <div
              aria-hidden={!(swipePreview.armed && swipePreview.direction === 1)}
              className="slide-swipe-indicator slide-swipe-indicator-next"
              data-armed={swipePreview.armed && swipePreview.direction === 1}
            >
              <strong>Next screen</strong>
              <Icon name="arrow-right" size={17} />
            </div>
          </div>

          <ReferenceOverlayLayer
            key={slide.id}
            ref={referenceLayerRef}
            references={references}
            slideId={slide.id}
          />

          {artworkMenu && (
            <ArtworkContextMenu
              onClose={() => setArtworkMenu(null)}
              onCreateComment={artworkMenu.canCreateComment && onCreateCommentAt
                ? () => {
                    const point = artworkMenu
                    setArtworkMenu(null)
                    onCreateCommentAt(point.x, point.y)
                  }
                : undefined}
              onPlaceReference={() => {
                const point = artworkMenu
                setArtworkMenu(null)
                referenceLayerRef.current?.openPicker(point.x, point.y)
              }}
              x={artworkMenu.x}
              y={artworkMenu.y}
            />
          )}

          {brand.logoUrl && brand.showOnCanvas && (
            <div
              className={`client-logo client-logo-${brand.position}`}
              style={{
                width: brand.width,
                height: brand.width,
                opacity: brand.opacity,
                margin: brand.margin
              }}
            >
              <img alt="Client logo" draggable={false} src={brand.logoUrl} />
            </div>
          )}

        </>
      )}
    </main>
  )
}
