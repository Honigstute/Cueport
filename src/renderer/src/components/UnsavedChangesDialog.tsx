import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface UnsavedChangesDialogProps {
  isSaving: boolean
  isSavedPresentation: boolean
  onCancel: () => void
  onDiscard: () => void
  onSave: () => void
}

export function UnsavedChangesDialog({
  isSaving,
  isSavedPresentation,
  onCancel,
  onDiscard,
  onSave
}: UnsavedChangesDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && !isSaving) {
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop unsaved-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !isSaving && onCancel()}
    >
      <section
        aria-labelledby="unsaved-changes-title"
        aria-modal="true"
        className="rename-dialog unsaved-dialog"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className="rename-dialog-copy">
          <span className="eyebrow">Presentation</span>
          <h2 id="unsaved-changes-title">Save changes?</h2>
          <p>
            {isSavedPresentation
              ? 'The presentation has changed since it was last saved.'
              : 'This presentation has not been saved on this computer yet.'}
          </p>
        </div>
        <div className="rename-dialog-actions unsaved-dialog-actions">
          <button disabled={isSaving} onClick={onCancel} type="button">Cancel</button>
          <button className="discard" disabled={isSaving} onClick={onDiscard} type="button">Don’t save</button>
          <button className="primary" data-initial-focus disabled={isSaving} onClick={onSave} type="button">
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}
