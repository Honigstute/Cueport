import { useEffect, useRef, useState } from 'react'
import {
  resolveFilmstripDestination,
  resolveFilmstripPreviewShift,
  type FilmstripDropEdge
} from '../lib/filmstripReorder'
import { formatSequenceTitle } from '../lib/sequenceTitles'
import type { ReferenceAsset, SequenceTitleSettings, SlideAsset } from '../types'
import { Icon } from './Icon'
import { RenameSlideDialog, SlideContextMenu } from './SlideActions'

interface FilmstripProps {
  slides: SlideAsset[]
  references: ReferenceAsset[]
  activeTab: 'sequence' | 'references'
  activeId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onRename: (id: string, name: string) => Promise<void>
  onMove: (fromIndex: number, toIndex: number) => void
  onMoveReference: (fromIndex: number, toIndex: number) => void
  onChooseMedia: () => void
  onChooseReferences: () => void
  onRemoveReference: (id: string) => void
  onTabChange: (tab: 'sequence' | 'references') => void
  sequenceTitles: SequenceTitleSettings
}

function FilmstripThumbnail({ asset, index }: { asset: SlideAsset | ReferenceAsset; index: number }): React.JSX.Element {
  const hasPoster = Boolean(asset.thumbnailUrl && asset.thumbnailUrl !== asset.url)
  return (
    <span className="thumbnail-frame">
      {hasPoster ? (
        <img alt="" decoding="async" draggable={false} loading="lazy" src={asset.thumbnailUrl} />
      ) : (
        <span aria-hidden="true" className="thumbnail-frame-fallback">
          <Icon name={asset.mimeType === 'video/mp4' ? 'play' : 'image'} size={20} />
        </span>
      )}
      {hasPoster && asset.mimeType === 'video/mp4' && <span aria-hidden="true" className="thumbnail-video-badge"><Icon name="play" size={15} /></span>}
      <span className="slide-number">{index + 1}</span>
    </span>
  )
}

export function Filmstrip({
  slides,
  references,
  activeTab,
  activeId,
  onSelect,
  onRemove,
  onRename,
  onMove,
  onMoveReference,
  onChooseMedia,
  onChooseReferences,
  onRemoveReference,
  onTabChange,
  sequenceTitles
}: FilmstripProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const pointerCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [destinationIndex, setDestinationIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: FilmstripDropEdge } | null>(null)
  const [cardStep, setCardStep] = useState(0)
  const [dragOffsetY, setDragOffsetY] = useState(0)
  const [contextMenu, setContextMenu] = useState<{ slideId: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const assets = activeTab === 'sequence' ? slides : references
  const isSequence = activeTab === 'sequence'
  const draggedIndex = draggedId ? assets.findIndex((asset) => asset.id === draggedId) : -1
  const contextSlide = contextMenu ? slides.find((slide) => slide.id === contextMenu.slideId) ?? null : null
  const renamingSlide = renamingId ? slides.find((slide) => slide.id === renamingId) ?? null : null

  const clearReorder = (): void => {
    setDraggedId(null)
    setDestinationIndex(null)
    setDropTarget(null)
    setCardStep(0)
    setDragOffsetY(0)
  }

  useEffect(() => () => pointerCleanupRef.current?.(), [])
  useEffect(() => {
    pointerCleanupRef.current?.()
    setDraggedId(null)
    setDestinationIndex(null)
    setDropTarget(null)
    setCardStep(0)
    setDragOffsetY(0)
    setContextMenu(null)
    setRenamingId(null)
  }, [activeTab])

  const beginPointerReorder = (
    event: React.PointerEvent<HTMLElement>,
    slide: SlideAsset,
    sourceIndex: number
  ): void => {
    if (
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      event.target.closest('.slide-remove')
    ) return

    const list = listRef.current
    if (!list) return
    const sourceCard = event.currentTarget

    pointerCleanupRef.current?.()
    const listGap = Number.parseFloat(getComputedStyle(list).rowGap) || 0
    const origin = {
      active: false,
      destinationIndex: sourceIndex,
      pointerId: event.pointerId,
      sourceIndex,
      startScrollTop: list.scrollTop,
      startX: event.clientX,
      startY: event.clientY
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('keydown', handleKeyDown)
      pointerCleanupRef.current = null
    }

    const finish = (commit: boolean): void => {
      cleanup()
      if (origin.active) {
        suppressClickRef.current = true
        window.setTimeout(() => { suppressClickRef.current = false }, 0)
        if (commit && origin.destinationIndex !== origin.sourceIndex) {
          if (isSequence) onMove(origin.sourceIndex, origin.destinationIndex)
          else onMoveReference(origin.sourceIndex, origin.destinationIndex)
        }
      }
      clearReorder()
    }

    const handlePointerMove = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== origin.pointerId) return
      const deltaX = pointerEvent.clientX - origin.startX
      const deltaY = pointerEvent.clientY - origin.startY

      if (!origin.active) {
        if (Math.hypot(deltaX, deltaY) < 5) return
        origin.active = true
        setDraggedId(slide.id)
        setDestinationIndex(sourceIndex)
        setCardStep(sourceCard.getBoundingClientRect().height + listGap)
      }

      pointerEvent.preventDefault()

      const bounds = list.getBoundingClientRect()
      const edgeDistance = 48
      if (pointerEvent.clientY < bounds.top + edgeDistance) list.scrollBy({ top: -14 })
      else if (pointerEvent.clientY > bounds.bottom - edgeDistance) list.scrollBy({ top: 14 })

      setDragOffsetY(deltaY + list.scrollTop - origin.startScrollTop)

      const candidates = Array.from(list.querySelectorAll<HTMLElement>('.slide-card'))
        .filter((card) => card.dataset.slideId !== slide.id)
      const target = candidates.find((card) => pointerEvent.clientY < card.getBoundingClientRect().bottom)
        ?? candidates.at(-1)
      if (!target) return

      const targetIndex = Number(target.dataset.slideIndex)
      const targetId = target.dataset.slideId!
      const targetBounds = target.getBoundingClientRect()
      const edge: FilmstripDropEdge = pointerEvent.clientY < targetBounds.top + targetBounds.height / 2
        ? 'before'
        : 'after'
      const nextDestination = resolveFilmstripDestination(sourceIndex, targetIndex, edge, assets.length)
      origin.destinationIndex = nextDestination
      setDestinationIndex((current) => current === nextDestination ? current : nextDestination)
      setDropTarget((current) => (
        current && current.id === targetId && current.edge === edge
          ? current
          : { id: targetId, edge }
      ))
    }

    const handlePointerUp = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId === origin.pointerId) finish(true)
    }
    const handlePointerCancel = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId === origin.pointerId) finish(false)
    }
    const handleKeyDown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key === 'Escape') finish(false)
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('keydown', handleKeyDown)
    pointerCleanupRef.current = cleanup
  }

  return (
    <aside className="filmstrip" aria-label="Presentation media">
      <div aria-label="Media trays" className="filmstrip-tabs" role="tablist">
        <button
          aria-selected={isSequence}
          data-active={isSequence}
          onClick={() => onTabChange('sequence')}
          role="tab"
          tabIndex={isSequence ? 0 : -1}
          type="button"
        >
          <Icon name="layers" size={16} />
          <span>Sequence</span>
        </button>
        <button
          aria-selected={!isSequence}
          data-active={!isSequence}
          onClick={() => onTabChange('references')}
          role="tab"
          tabIndex={!isSequence ? 0 : -1}
          type="button"
        >
          <Icon name="image" size={16} />
          <span>References</span>
        </button>
      </div>

      <div
        aria-label={isSequence ? 'Sequence media' : 'Reference media'}
        className="filmstrip-list"
        data-reordering={draggedId !== null}
        ref={listRef}
        role="tabpanel"
      >
        {assets.length === 0 && (
          <div className="filmstrip-empty">
            <span><Icon name="image" size={17} /></span>
            <strong>{isSequence ? 'No frames yet' : 'No references yet'}</strong>
            <small>{isSequence ? 'Add images or videos to build a sequence' : 'Add static layouts or animation examples'}</small>
          </div>
        )}
        {assets.map((asset, index) => {
          const displayTitle = formatSequenceTitle(asset.name, sequenceTitles)

          return (
            <article
              className="slide-card"
              data-active={isSequence && activeId === asset.id}
              data-drag-source={draggedId === asset.id}
              data-drop-edge={dropTarget?.id === asset.id ? dropTarget.edge : undefined}
              data-slide-id={asset.id}
              data-slide-index={index}
              key={asset.id}
              onClickCapture={(event) => {
                if (!suppressClickRef.current) return
                event.preventDefault()
                event.stopPropagation()
                suppressClickRef.current = false
              }}
              onPointerDown={(event) => beginPointerReorder(event, asset, index)}
              onContextMenu={(event) => {
                if (!isSequence) return
                event.preventDefault()
                setContextMenu({ slideId: asset.id, x: event.clientX, y: event.clientY })
              }}
              style={{
                '--reorder-shift': `${
                  draggedId === asset.id
                    ? dragOffsetY
                    : draggedIndex >= 0 && destinationIndex !== null
                    ? resolveFilmstripPreviewShift(index, draggedIndex, destinationIndex, cardStep)
                    : 0
                }px`
              } as React.CSSProperties}
            >
              {isSequence ? <button
                aria-current={activeId === asset.id ? 'true' : undefined}
                className="slide-select"
                onClick={() => onSelect(asset.id)}
                type="button"
              >
                <FilmstripThumbnail asset={asset} index={index} />
                <span className="slide-details">
                  <span className="slide-name" title={asset.name}>{displayTitle}</span>
                </span>
              </button> : <div aria-label={`Reference ${index + 1}: ${asset.name}`} className="slide-select reference-select">
                <FilmstripThumbnail asset={asset} index={index} />
                <span className="slide-details">
                  <span className="slide-name" title={asset.name}>{displayTitle}</span>
                </span>
              </div>}
              <button
                className="slide-remove"
                onClick={() => isSequence ? onRemove(asset.id) : onRemoveReference(asset.id)}
                title={`Remove ${asset.name}`}
                type="button"
              >
                <Icon name="close" size={13} />
                <span className="sr-only">Remove {asset.name}</span>
              </button>
            </article>
          )
        })}
      </div>

      <button className="filmstrip-add" onClick={isSequence ? onChooseMedia : onChooseReferences} type="button">
        <Icon name="add" size={15} />
        {isSequence ? 'Add media' : 'Add references'}
      </button>

      {contextSlide && contextMenu && (
        <SlideContextMenu
          onClose={() => setContextMenu(null)}
          onRemove={() => {
            setContextMenu(null)
            onRemove(contextSlide.id)
          }}
          onRename={() => {
            setContextMenu(null)
            setRenamingId(contextSlide.id)
          }}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}

      {renamingSlide && (
        <RenameSlideDialog
          onCancel={() => setRenamingId(null)}
          onRename={(name) => onRename(renamingSlide.id, name)}
          slide={renamingSlide}
        />
      )}
    </aside>
  )
}
