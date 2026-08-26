import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SavedPresentationSummary } from '../../../shared/projects'

interface DeletePresentationDialogProps {
  presentation: SavedPresentationSummary
  onCancel: () => void
  onDelete: () => Promise<void>
}

export function DeletePresentationDialog({
  presentation,
  onCancel,
  onDelete
}: DeletePresentationDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
  }, [])

  const handleDelete = async (): Promise<void> => {
    setError(null)
    setIsDeleting(true)
    try {
      await onDelete()
      onCancel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The presentation could not be deleted.')
    } finally {
      setIsDeleting(false)
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop delete-presentation-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !isDeleting && onCancel()}
    >
      <section
        aria-labelledby="delete-presentation-title"
        aria-modal="true"
        className="rename-dialog delete-presentation-dialog"
        onKeyDown={(event) => event.key === 'Escape' && !isDeleting && onCancel()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="rename-dialog-copy">
          <span className="eyebrow">Presentation</span>
          <h2 id="delete-presentation-title">Delete {presentation.name}?</h2>
          <p>The saved presentation and its local copies will be removed. This cannot be undone.</p>
        </div>
        {error && <p className="field-error rename-error">{error}</p>}
        <div className="rename-dialog-actions">
          <button data-initial-focus disabled={isDeleting} onClick={onCancel} type="button">Cancel</button>
          <button className="danger-primary" disabled={isDeleting} onClick={() => void handleDelete()} type="button">
            {isDeleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}
