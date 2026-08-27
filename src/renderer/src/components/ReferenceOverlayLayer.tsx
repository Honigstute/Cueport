import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  createReferenceOverlayRect,
  moveReferenceOverlayRect,
  resizeReferenceOverlayRect,
  type ReferenceOverlayRect,
  type ReferenceResizeCorner
} from '../lib/referenceOverlay'
import type { ReferenceAsset } from '../types'
import { Icon } from './Icon'

export interface ReferenceOverlayLayerHandle {
  openPicker: (clientX: number, clientY: number) => void
}

interface ReferenceOverlayLayerProps {
  references: ReferenceAsset[]
  slideId: string
}

interface ActiveReferenceOverlay extends ReferenceOverlayRect {
  id: string
  referenceId: string
}

interface MenuPoint {
  x: number
  y: number
}

interface PickerPoint extends MenuPoint {
  anchorX: number
  anchorY: number
}

interface RemoveMenuPoint extends MenuPoint {
  overlayId: string
}

const RESIZE_CORNERS: ReferenceResizeCorner[] = [
  'north-west',
  'north-east',
  'south-west',
  'south-east'
]

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function createOverlayId(): string {
  return globalThis.crypto.randomUUID()
}

/** Native video controls occupy the lower edge; keep that area interactive. */
function isVideoControlArea(event: React.PointerEvent<HTMLDivElement>): boolean {
  const video = event.target instanceof Element ? event.target.closest('video') : null
  if (!(video instanceof HTMLVideoElement)) return false
  const bounds = video.getBoundingClientRect()
  const controlHeight = Math.min(48, Math.max(30, bounds.height * 0.3))
  return event.clientY >= bounds.bottom - controlHeight
}

/** Temporary, screen-fixed reference artwork that deliberately never enters saved state. */
export const ReferenceOverlayLayer = forwardRef<ReferenceOverlayLayerHandle, ReferenceOverlayLayerProps>(
  function ReferenceOverlayLayer({ references, slideId }, forwardedRef): React.JSX.Element {
    const layerRef = useRef<HTMLDivElement>(null)
    const interactionCleanupRef = useRef<(() => void) | null>(null)
    const [overlays, setOverlays] = useState<ActiveReferenceOverlay[]>([])
    const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null)
    const [picker, setPicker] = useState<PickerPoint | null>(null)
    const [removeMenu, setRemoveMenu] = useState<RemoveMenuPoint | null>(null)

    const removeOverlay = useCallback((overlayId: string): void => {
      interactionCleanupRef.current?.()
      setOverlays((current) => current.filter((overlay) => overlay.id !== overlayId))
      setSelectedOverlayId((current) => current === overlayId ? null : current)
      setRemoveMenu((current) => current?.overlayId === overlayId ? null : current)
    }, [])

    const selectOverlay = useCallback((overlayId: string): void => {
      setSelectedOverlayId(overlayId)
      setRemoveMenu(null)
      setOverlays((current) => {
        const index = current.findIndex((overlay) => overlay.id === overlayId)
        if (index < 0 || index === current.length - 1) return current
        const next = [...current]
        const [overlay] = next.splice(index, 1)
        next.push(overlay)
        return next
      })
    }, [])

    useImperativeHandle(forwardedRef, () => ({
      openPicker: (clientX, clientY) => {
        const bounds = layerRef.current?.getBoundingClientRect()
        if (!bounds) return
        setRemoveMenu(null)
        setPicker({
          x: clientX,
          y: clientY,
          anchorX: clientX - bounds.left,
          anchorY: clientY - bounds.top
        })
      }
    }), [])

    useEffect(() => {
      interactionCleanupRef.current?.()
      setOverlays([])
      setSelectedOverlayId(null)
      setPicker(null)
      setRemoveMenu(null)
    }, [slideId])

    useEffect(() => {
      const referenceIds = new Set(references.map((reference) => reference.id))
      setOverlays((current) => {
        const next = current.filter((overlay) => referenceIds.has(overlay.referenceId))
        return next.length === current.length ? current : next
      })
      setSelectedOverlayId((current) => {
        if (!current) return null
        return overlays.some((overlay) => overlay.id === current && referenceIds.has(overlay.referenceId))
          ? current
          : null
      })
      setRemoveMenu((current) => {
        if (!current) return null
        return overlays.some((overlay) => overlay.id === current.overlayId && referenceIds.has(overlay.referenceId))
          ? current
          : null
      })
    }, [overlays, references])

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          setPicker(null)
          setRemoveMenu(null)
          setSelectedOverlayId(null)
          return
        }
        if (
          selectedOverlayId &&
          (event.key === 'Backspace' || event.key === 'Delete') &&
          !isTextInput(event.target)
        ) {
          event.preventDefault()
          removeOverlay(selectedOverlayId)
        }
      }

      const deselectOutside = (event: PointerEvent): void => {
        if (!(event.target instanceof Element)) return
        if (event.target.closest('.reference-overlay, .reference-picker-menu, .reference-overlay-menu')) return
        setSelectedOverlayId(null)
        setRemoveMenu(null)
      }

      const keepInsideStage = (): void => {
        const bounds = layerRef.current?.getBoundingClientRect()
        if (!bounds) return
        setOverlays((current) => current.map((overlay) => ({
          ...overlay,
          ...moveReferenceOverlayRect(overlay, 0, 0, bounds.width, bounds.height)
        })))
      }

      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('pointerdown', deselectOutside, true)
      window.addEventListener('resize', keepInsideStage)
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        window.removeEventListener('pointerdown', deselectOutside, true)
        window.removeEventListener('resize', keepInsideStage)
      }
    }, [removeOverlay, selectedOverlayId])

    useEffect(() => () => interactionCleanupRef.current?.(), [])

    const chooseReference = (reference: ReferenceAsset): void => {
      const bounds = layerRef.current?.getBoundingClientRect()
      if (!bounds || !picker) return
      const overlayId = createOverlayId()
      setOverlays((current) => [...current, {
        ...createReferenceOverlayRect(
          bounds.width,
          bounds.height,
          reference.width,
          reference.height,
          picker.anchorX,
          picker.anchorY
        ),
        id: overlayId,
        referenceId: reference.id
      }])
      setPicker(null)
      setSelectedOverlayId(overlayId)
    }

    const beginMove = (event: React.PointerEvent<HTMLDivElement>, overlayId: string): void => {
      if (event.button !== 0) return
      if (isVideoControlArea(event)) {
        // Do not prevent the native play, scrub, volume, or fullscreen action.
        event.stopPropagation()
        return
      }
      const overlay = overlays.find((candidate) => candidate.id === overlayId)
      if (!overlay) return
      event.preventDefault()
      event.stopPropagation()
      selectOverlay(overlayId)
      interactionCleanupRef.current?.()
      const bounds = layerRef.current?.getBoundingClientRect()
      if (!bounds) return
      const origin = overlay
      const startX = event.clientX
      const startY = event.clientY

      const handlePointerMove = (pointerEvent: PointerEvent): void => {
        setOverlays((current) => current.map((candidate) => candidate.id === overlayId
          ? {
              ...candidate,
              ...moveReferenceOverlayRect(
                origin,
                pointerEvent.clientX - startX,
                pointerEvent.clientY - startY,
                bounds.width,
                bounds.height
              )
            }
          : candidate))
      }
      const cleanup = (): void => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', cleanup)
        window.removeEventListener('pointercancel', cleanup)
        interactionCleanupRef.current = null
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', cleanup)
      window.addEventListener('pointercancel', cleanup)
      interactionCleanupRef.current = cleanup
    }

    const beginResize = (
      event: React.PointerEvent<HTMLButtonElement>,
      overlayId: string,
      corner: ReferenceResizeCorner
    ): void => {
      if (event.button !== 0) return
      const overlay = overlays.find((candidate) => candidate.id === overlayId)
      if (!overlay) return
      event.preventDefault()
      event.stopPropagation()
      selectOverlay(overlayId)
      interactionCleanupRef.current?.()
      const bounds = layerRef.current?.getBoundingClientRect()
      if (!bounds) return
      const origin = overlay
      const startX = event.clientX
      const startY = event.clientY

      const handlePointerMove = (pointerEvent: PointerEvent): void => {
        setOverlays((current) => current.map((candidate) => candidate.id === overlayId
          ? {
              ...candidate,
              ...resizeReferenceOverlayRect(
                origin,
                corner,
                pointerEvent.clientX - startX,
                pointerEvent.clientY - startY,
                bounds.width,
                bounds.height
              )
            }
          : candidate))
      }
      const cleanup = (): void => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', cleanup)
        window.removeEventListener('pointercancel', cleanup)
        interactionCleanupRef.current = null
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', cleanup)
      window.addEventListener('pointercancel', cleanup)
      interactionCleanupRef.current = cleanup
    }

    return (
      <div className="reference-overlay-layer" ref={layerRef}>
        {overlays.map((overlay) => {
          const reference = references.find((candidate) => candidate.id === overlay.referenceId)
          if (!reference) return null
          const isSelected = selectedOverlayId === overlay.id

          return (
            <div
              aria-label={`Reference overlay: ${reference.name}`}
              className="reference-overlay"
              data-no-pan="true"
              data-selected={isSelected}
              key={overlay.id}
              onFocus={() => selectOverlay(overlay.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                selectOverlay(overlay.id)
                setPicker(null)
                setRemoveMenu({ overlayId: overlay.id, x: event.clientX, y: event.clientY })
              }}
              onPointerDown={(event) => beginMove(event, overlay.id)}
              role="group"
              style={{
                height: overlay.height,
                transform: `translate3d(${overlay.x}px, ${overlay.y}px, 0)`,
                width: overlay.width
              }}
              tabIndex={0}
            >
              {reference.mimeType === 'video/mp4' ? (
                <video
                  aria-label={reference.name}
                  controls
                  draggable={false}
                  loop
                  playsInline
                  poster={reference.thumbnailUrl}
                  preload="metadata"
                  src={reference.url}
                />
              ) : (
                <img alt={reference.name} draggable={false} src={reference.url} />
              )}
              {RESIZE_CORNERS.map((corner) => (
                <button
                  aria-label={`Resize from ${corner.replace('-', ' ')}`}
                  className={`reference-resize-handle reference-resize-handle-${corner}`}
                  key={corner}
                  onPointerDown={(event) => beginResize(event, overlay.id, corner)}
                  tabIndex={isSelected ? 0 : -1}
                  type="button"
                />
              ))}
            </div>
          )
        })}

        {picker && (
          <ReferencePickerMenu
            onChoose={chooseReference}
            onClose={() => setPicker(null)}
            references={references}
            x={picker.x}
            y={picker.y}
          />
        )}
        {removeMenu && (
          <ReferenceRemoveMenu
            onClose={() => setRemoveMenu(null)}
            onRemove={() => removeOverlay(removeMenu.overlayId)}
            x={removeMenu.x}
            y={removeMenu.y}
          />
        )}
      </div>
    )
  }
)

interface ReferencePickerMenuProps extends MenuPoint {
  references: ReferenceAsset[]
  onChoose: (reference: ReferenceAsset) => void
  onClose: () => void
}

function ReferencePickerMenu({ references, onChoose, onClose, x, y }: ReferencePickerMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const left = Math.max(8, Math.min(x, window.innerWidth - 300))
  const top = Math.max(8, Math.min(y, window.innerHeight - 360))

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
    <div
      aria-label="Choose a reference"
      className="reference-picker-menu"
      ref={menuRef}
      role="menu"
      style={{ left, top }}
    >
      <div className="reference-picker-heading">
        <Icon name="image" size={16} />
        <strong>Show reference</strong>
      </div>
      {references.length > 0 ? (
        <div className="reference-picker-grid">
          {references.map((reference) => (
            <button key={reference.id} onClick={() => onChoose(reference)} role="menuitem" type="button">
              <span>
                <img alt="" draggable={false} src={reference.thumbnailUrl} />
                {reference.mimeType === 'video/mp4' && (
                  <span aria-hidden="true" className="thumbnail-video-badge"><Icon name="play" size={15} /></span>
                )}
              </span>
              <small title={reference.name}>{reference.name}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="reference-picker-empty">Add images or videos in the References tray first.</p>
      )}
    </div>,
    document.body
  )
}

interface ReferenceRemoveMenuProps extends MenuPoint {
  onClose: () => void
  onRemove: () => void
}

function ReferenceRemoveMenu({ onClose, onRemove, x, y }: ReferenceRemoveMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const left = Math.max(8, Math.min(x, window.innerWidth - 184))
  const top = Math.max(8, Math.min(y, window.innerHeight - 56))

  useEffect(() => {
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) onClose()
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('resize', onClose)
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <div className="reference-overlay-menu slide-context-menu" ref={menuRef} role="menu" style={{ left, top }}>
      <button className="danger" onClick={onRemove} role="menuitem" type="button">
        <Icon name="remove" size={15} />
        <span>Remove overlay</span>
      </button>
    </div>,
    document.body
  )
}
