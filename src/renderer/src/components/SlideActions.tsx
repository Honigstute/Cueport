import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SlideAsset } from '../types'
import { Icon } from './Icon'

interface SlideContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onRemove: () => void
  onRename: () => void
}

export function SlideContextMenu({ x, y, onClose, onRemove, onRename }: SlideContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const left = Math.min(x, window.innerWidth - 184)
  const top = Math.min(y, window.innerHeight - 104)

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
      aria-label="Media actions"
      className="slide-context-menu"
      ref={menuRef}
      role="menu"
      style={{ left, top }}
    >
      <button onClick={onRename} role="menuitem" type="button">
        <Icon name="edit" size={15} />
        <span>Rename file</span>
      </button>
      <button className="danger" onClick={onRemove} role="menuitem" type="button">
        <Icon name="remove" size={15} />
        <span>Remove from sequence</span>
      </button>
    </div>,
    document.body
  )
}

interface RenameSlideDialogProps {
  slide: SlideAsset
  onCancel: () => void
  onRename: (name: string) => Promise<void>
}

function splitFileName(name: string): { baseName: string; extension: string } {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0) return { baseName: name, extension: '' }
  return { baseName: name.slice(0, dotIndex), extension: name.slice(dotIndex) }
}

export function RenameSlideDialog({ slide, onCancel, onRename }: RenameSlideDialogProps): React.JSX.Element {
  const { baseName, extension } = splitFileName(slide.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(baseName)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const nextBaseName = draft.trim()
    if (!nextBaseName || /[<>:"/\\|?*\u0000-\u001F]/.test(nextBaseName)) {
      setError('Use a name without slashes or reserved characters.')
      return
    }

    setError(null)
    setIsSaving(true)
    try {
      await onRename(`${nextBaseName}${extension}`)
      onCancel()
    } catch {
      setError('The file could not be renamed. Check whether that name already exists.')
    } finally {
      setIsSaving(false)
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop rename-dialog-backdrop"
      onKeyDown={(event) => event.key === 'Escape' && !isSaving && onCancel()}
      onMouseDown={(event) => event.target === event.currentTarget && !isSaving && onCancel()}
    >
      <form aria-labelledby="rename-image-title" aria-modal="true" className="rename-dialog" onSubmit={(event) => void submit(event)} role="dialog">
        <div className="rename-dialog-copy">
          <span className="eyebrow">Sequence item</span>
          <h2 id="rename-image-title">Rename file</h2>
          <p>{slide.sourceKey ? 'The original source file will be renamed too.' : 'Only the sequence title will change.'}</p>
        </div>
        <label className="rename-field">
          <span>File name</span>
          <span className="rename-input-shell">
            <input
              autoComplete="off"
              disabled={isSaving}
              onChange={(event) => setDraft(event.target.value)}
              ref={inputRef}
              spellCheck={false}
              value={draft}
            />
            <span aria-hidden="true">{extension}</span>
          </span>
        </label>
        {error && <p className="field-error rename-error">{error}</p>}
        <div className="rename-dialog-actions">
          <button disabled={isSaving} onClick={onCancel} type="button">Cancel</button>
          <button className="primary" disabled={isSaving} type="submit">{isSaving ? 'Renaming…' : 'Rename'}</button>
        </div>
      </form>
    </div>,
    document.body
  )
}
