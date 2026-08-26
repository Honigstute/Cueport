import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface PresentationNameDialogProps {
  initialName: string
  mode: 'save' | 'rename'
  onCancel: () => void
  onSubmit: (name: string) => Promise<void>
}

export function PresentationNameDialog({ initialName, mode, onCancel, onSubmit }: PresentationNameDialogProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const name = draft.trim().replace(/\s+/g, ' ')
    if (!name || name.length > 120) {
      setError('Use a presentation name shorter than 120 characters.')
      return
    }

    setError(null)
    setIsSaving(true)
    try {
      await onSubmit(name)
      onCancel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The presentation name could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  const title = mode === 'save' ? 'Save presentation' : 'Rename presentation'
  return createPortal(
    <div
      className="dialog-backdrop rename-dialog-backdrop"
      onKeyDown={(event) => event.key === 'Escape' && !isSaving && onCancel()}
      onMouseDown={(event) => event.target === event.currentTarget && !isSaving && onCancel()}
    >
      <form aria-labelledby="presentation-name-title" aria-modal="true" className="rename-dialog presentation-name-dialog" onSubmit={(event) => void submit(event)} role="dialog">
        <div className="rename-dialog-copy">
          <span className="eyebrow">Presentation</span>
          <h2 id="presentation-name-title">{title}</h2>
          <p>{mode === 'save' ? 'Cueport keeps the compilation and its images together on this computer.' : 'The saved presentation card will use this name.'}</p>
        </div>
        <label className="rename-field">
          <span>Presentation name</span>
          <span className="rename-input-shell">
            <input
              autoComplete="off"
              disabled={isSaving}
              onChange={(event) => setDraft(event.target.value)}
              ref={inputRef}
              spellCheck={false}
              value={draft}
            />
          </span>
        </label>
        {error && <p className="field-error rename-error">{error}</p>}
        <div className="rename-dialog-actions">
          <button disabled={isSaving} onClick={onCancel} type="button">Cancel</button>
          <button className="primary" disabled={isSaving} type="submit">
            {isSaving ? (mode === 'save' ? 'Saving…' : 'Renaming…') : (mode === 'save' ? 'Save' : 'Rename')}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
