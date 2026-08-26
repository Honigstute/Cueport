import { useEffect, useRef, useState } from 'react'
import type { SavedPresentationSummary } from '../../../shared/projects'
import { resolveFilmstripDestination, type FilmstripDropEdge } from '../lib/filmstripReorder'
import { DeletePresentationDialog } from './DeletePresentationDialog'
import { Icon } from './Icon'

interface HomeScreenProps {
  isLoading: boolean
  openingId: string | null
  presentations: SavedPresentationSummary[]
  onNew: () => void
  onOpen: (id: string) => void
  onRename: (presentation: SavedPresentationSummary) => void
  onDelete: (presentation: SavedPresentationSummary) => Promise<void>
  onMove: (fromIndex: number, toIndex: number) => void
}

interface Point {
  x: number
  y: number
}

function formatSavedDate(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Saved locally'
  return `Saved ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)}`
}

/** Moves surrounding cards into the real destination slots while dragging. */
function previewOffset(
  itemIndex: number,
  sourceIndex: number,
  destinationIndex: number,
  cardRects: DOMRect[]
): Point {
  let slotIndex = itemIndex
  if (sourceIndex < destinationIndex && itemIndex > sourceIndex && itemIndex <= destinationIndex) {
    slotIndex = itemIndex - 1
  } else if (sourceIndex > destinationIndex && itemIndex >= destinationIndex && itemIndex < sourceIndex) {
    slotIndex = itemIndex + 1
  }

  const source = cardRects[itemIndex]
  const destination = cardRects[slotIndex]
  return source && destination
    ? { x: destination.left - source.left, y: destination.top - source.top }
    : { x: 0, y: 0 }
}

export function HomeScreen({
  isLoading,
  openingId,
  presentations,
  onNew,
  onOpen,
  onRename,
  onDelete,
  onMove
}: HomeScreenProps): React.JSX.Element {
  const homeRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pointerCleanupRef = useRef<(() => void) | null>(null)
  const suppressClickRef = useRef(false)
  const cardRectsRef = useRef<DOMRect[]>([])
  const [menuId, setMenuId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavedPresentationSummary | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [destinationIndex, setDestinationIndex] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: FilmstripDropEdge } | null>(null)
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 })
  const draggedIndex = draggedId ? presentations.findIndex((presentation) => presentation.id === draggedId) : -1

  useEffect(() => {
    if (!menuId) return
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) setMenuId(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuId(null)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuId])

  useEffect(() => () => pointerCleanupRef.current?.(), [])

  const clearReorder = (): void => {
    setDraggedId(null)
    setDestinationIndex(null)
    setDropTarget(null)
    setDragOffset({ x: 0, y: 0 })
    cardRectsRef.current = []
  }

  const beginPointerReorder = (
    event: React.PointerEvent<HTMLElement>,
    presentation: SavedPresentationSummary,
    sourceIndex: number
  ): void => {
    if (
      event.button !== 0 ||
      openingId !== null ||
      !(event.target instanceof Element) ||
      event.target.closest('.presentation-more, .presentation-card-menu')
    ) return

    const grid = gridRef.current
    const home = homeRef.current
    if (!grid || !home) return

    pointerCleanupRef.current?.()
    const origin = {
      active: false,
      destinationIndex: sourceIndex,
      pointerId: event.pointerId,
      sourceIndex,
      startScrollTop: home.scrollTop,
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
          onMove(origin.sourceIndex, origin.destinationIndex)
        }
      }
      clearReorder()
    }

    const handlePointerMove = (pointerEvent: PointerEvent): void => {
      if (pointerEvent.pointerId !== origin.pointerId) return
      const deltaX = pointerEvent.clientX - origin.startX
      const deltaY = pointerEvent.clientY - origin.startY

      if (!origin.active) {
        if (Math.hypot(deltaX, deltaY) < 6) return
        origin.active = true
        setMenuId(null)
        setDraggedId(presentation.id)
        setDestinationIndex(sourceIndex)
        cardRectsRef.current = Array.from(grid.querySelectorAll<HTMLElement>('.presentation-card[data-presentation-id]'))
          .map((card) => card.getBoundingClientRect())
      }

      pointerEvent.preventDefault()
      const homeBounds = home.getBoundingClientRect()
      const edgeDistance = 56
      if (pointerEvent.clientY < homeBounds.top + edgeDistance) home.scrollBy({ top: -16 })
      else if (pointerEvent.clientY > homeBounds.bottom - edgeDistance) home.scrollBy({ top: 16 })

      setDragOffset({
        x: deltaX,
        y: deltaY + home.scrollTop - origin.startScrollTop
      })

      const candidates = Array.from(grid.querySelectorAll<HTMLElement>('.presentation-card[data-presentation-id]'))
        .filter((card) => card.dataset.presentationId !== presentation.id)
      if (candidates.length === 0) return

      const target = candidates.find((card) => {
        const bounds = card.getBoundingClientRect()
        return pointerEvent.clientX >= bounds.left && pointerEvent.clientX <= bounds.right &&
          pointerEvent.clientY >= bounds.top && pointerEvent.clientY <= bounds.bottom
      }) ?? candidates.reduce((closest, card) => {
        const closestBounds = closest.getBoundingClientRect()
        const bounds = card.getBoundingClientRect()
        const closestDistance = Math.hypot(
          pointerEvent.clientX - (closestBounds.left + closestBounds.width / 2),
          pointerEvent.clientY - (closestBounds.top + closestBounds.height / 2)
        )
        const distance = Math.hypot(
          pointerEvent.clientX - (bounds.left + bounds.width / 2),
          pointerEvent.clientY - (bounds.top + bounds.height / 2)
        )
        return distance < closestDistance ? card : closest
      })

      const targetIndex = Number(target.dataset.presentationIndex)
      const targetId = target.dataset.presentationId!
      const targetBounds = target.getBoundingClientRect()
      const edge: FilmstripDropEdge = pointerEvent.clientX < targetBounds.left + targetBounds.width / 2
        ? 'before'
        : 'after'
      const nextDestination = resolveFilmstripDestination(sourceIndex, targetIndex, edge, presentations.length)
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
    <main className="home-screen" ref={homeRef}>
      <div
        aria-label="Presentations"
        className="presentation-grid"
        data-reordering={draggedId !== null}
        ref={gridRef}
      >
        <button className="new-presentation-card" onClick={onNew} type="button">
          <span className="new-presentation-preview"><Icon name="add" size={24} /></span>
          <span className="presentation-card-copy">
            <strong>New presentation</strong>
            <small>Choose or drop images</small>
          </span>
        </button>

        {presentations.map((presentation, index) => {
          const offset = draggedId === presentation.id
            ? dragOffset
            : draggedIndex >= 0 && destinationIndex !== null
              ? previewOffset(index, draggedIndex, destinationIndex, cardRectsRef.current)
              : { x: 0, y: 0 }

          return (
            <article
              className="presentation-card"
              data-drag-source={draggedId === presentation.id}
              data-drop-edge={dropTarget?.id === presentation.id ? dropTarget.edge : undefined}
              data-presentation-id={presentation.id}
              data-presentation-index={index}
              key={presentation.id}
              onClickCapture={(event) => {
                if (!suppressClickRef.current) return
                event.preventDefault()
                event.stopPropagation()
                suppressClickRef.current = false
              }}
              onPointerDown={(event) => beginPointerReorder(event, presentation, index)}
              style={{
                '--presentation-reorder-x': `${offset.x}px`,
                '--presentation-reorder-y': `${offset.y}px`
              } as React.CSSProperties}
            >
              <button
                aria-label={`Open ${presentation.name}`}
                className="presentation-card-open"
                disabled={openingId !== null}
                onClick={() => onOpen(presentation.id)}
                type="button"
              >
                <span className="presentation-preview">
                  {presentation.previewUrl
                    ? <img alt="" src={presentation.previewUrl} />
                    : <Icon name="image" size={24} />}
                  {openingId === presentation.id && <span className="presentation-opening">Opening…</span>}
                </span>
                <span className="presentation-card-copy">
                  <strong>{presentation.name}</strong>
                  <small>{formatSavedDate(presentation.updatedAt)} · {presentation.slideCount} image{presentation.slideCount === 1 ? '' : 's'}</small>
                </span>
              </button>
              <button
                aria-expanded={menuId === presentation.id}
                aria-label={`Actions for ${presentation.name}`}
                className="presentation-more"
                onClick={() => setMenuId((current) => current === presentation.id ? null : presentation.id)}
                title="Presentation actions"
                type="button"
              >
                <Icon name="more" size={17} />
              </button>
              {menuId === presentation.id && (
                <div className="presentation-card-menu" ref={menuRef} role="menu">
                  <button
                    onClick={() => {
                      setMenuId(null)
                      onRename(presentation)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="edit" size={15} />
                    <span>Rename presentation</span>
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      setMenuId(null)
                      setDeleteTarget(presentation)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="remove" size={15} />
                    <span>Delete presentation</span>
                  </button>
                </div>
              )}
            </article>
          )
        })}

        {isLoading && Array.from({ length: 3 }, (_, index) => (
          <div aria-hidden="true" className="presentation-card presentation-card-loading" key={index}>
            <span className="presentation-preview" />
            <span className="presentation-card-copy"><i /><i /></span>
          </div>
        ))}
      </div>

      {deleteTarget && (
        <DeletePresentationDialog
          onCancel={() => setDeleteTarget(null)}
          onDelete={() => onDelete(deleteTarget)}
          presentation={deleteTarget}
        />
      )}
    </main>
  )
}
