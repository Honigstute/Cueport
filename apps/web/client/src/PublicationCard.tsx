import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { PresentationAccessDialog } from './PresentationAccessDialog'
import { formatBytes } from './formatBytes'

export interface PublishedPresentation {
  id: string
  name: string
  updatedAt: string
  slideCount: number
  publishedBytes: number
  canManage: boolean
  isPublic: boolean
  shareUrl: string | null
  thumbnailUrl: string | null
}

interface PublicationCardProps {
  copied: boolean
  presentation: PublishedPresentation
  onCopy: (presentation: PublishedPresentation) => void
  onDelete: (presentation: PublishedPresentation) => void
  onAccessSaved: () => void
  onRename: (presentation: PublishedPresentation, name: string) => Promise<void>
  onTakeOffline: (presentation: PublishedPresentation) => void
}

function formatPublishedDate(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'Publication date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function RenamePublicationDialog({
  presentation,
  onClose,
  onRename
}: {
  presentation: PublishedPresentation
  onClose: () => void
  onRename: (name: string) => Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState(presentation.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onRename(name)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The presentation could not be renamed.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop rename-dialog-backdrop"
      onKeyDown={(event) => event.key === 'Escape' && !busy && onClose()}
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form aria-labelledby="web-rename-title" aria-modal="true" className="rename-dialog presentation-name-dialog" onSubmit={(event) => void submit(event)} role="dialog">
        <div className="rename-dialog-copy">
          <span className="eyebrow">Presentation</span>
          <h2 id="web-rename-title">Rename presentation</h2>
        </div>
        <label className="rename-field">
          <span>Name</span>
          <span className="rename-input-shell">
            <input autoFocus disabled={busy} maxLength={120} onChange={(event) => setName(event.target.value)} value={name} />
          </span>
        </label>
        {error && <p className="field-error rename-error">{error}</p>}
        <div className="rename-dialog-actions">
          <button disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="primary" disabled={busy || !name.trim()} type="submit">{busy ? 'Renaming…' : 'Rename'}</button>
        </div>
      </form>
    </div>,
    document.body
  )
}

export function PublicationCard({
  copied,
  presentation,
  onCopy,
  onDelete,
  onAccessSaved,
  onRename,
  onTakeOffline
}: PublicationCardProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const storageLabel = `Live ${formatBytes(presentation.publishedBytes)}`

  useEffect(() => {
    if (!menuOpen) return
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const preview = (
    <span className="presentation-preview">
      {presentation.thumbnailUrl && <img alt="" loading="lazy" src={presentation.thumbnailUrl} />}
    </span>
  )

  return (
    <article className="presentation-card web-publication-card">
      {presentation.shareUrl
        ? <a aria-label={`Open ${presentation.name}`} className="web-publication-open" href={`${presentation.shareUrl}?from=dashboard`}>{preview}</a>
        : preview}
      <div className="web-publication-details">
        <div className="web-publication-summary">
          <div className="presentation-card-copy">
            <strong>{presentation.name}</strong>
            <small>{presentation.slideCount} {presentation.slideCount === 1 ? 'screen' : 'screens'}</small>
            <small>{presentation.canManage
              ? presentation.shareUrl ? presentation.isPublic ? 'Public link' : 'Restricted link' : 'Link offline'
              : 'Shared with you'} · {formatPublishedDate(presentation.updatedAt)}</small>
            <small
              className="web-publication-storage"
              title="Only the current live presentation is stored here. Server backups are not included."
            >
              {storageLabel}
            </small>
          </div>
          {presentation.canManage && <div className="web-publication-menu-wrap" ref={menuRef}>
            <button
              aria-expanded={menuOpen}
              aria-label={`Actions for ${presentation.name}`}
              className="presentation-more"
              onClick={() => setMenuOpen((open) => !open)}
              title="Presentation actions"
              type="button"
            >
              <Icon name="more" size={17} />
            </button>
            {menuOpen && (
              <div className="presentation-card-menu" role="menu">
                {presentation.shareUrl && (
                  <button
                    onClick={() => { setMenuOpen(false); setAccessOpen(true) }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="user" size={15} />
                    <span>Manage access</span>
                  </button>
                )}
                <button
                  onClick={() => { setMenuOpen(false); setRenameOpen(true) }}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="edit" size={15} />
                  <span>Rename presentation</span>
                </button>
                {presentation.shareUrl && (
                  <button
                    onClick={() => { setMenuOpen(false); onTakeOffline(presentation) }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon name="eye-off" size={15} />
                    <span>Take link offline</span>
                  </button>
                )}
                <button
                  className="danger"
                  onClick={() => { setMenuOpen(false); onDelete(presentation) }}
                  role="menuitem"
                  type="button"
                >
                  <Icon name="remove" size={15} />
                  <span>Delete presentation</span>
                </button>
              </div>
            )}
          </div>}
        </div>
        {presentation.shareUrl && (
          <button className="web-primary web-copy-feedback web-publication-copy" onClick={() => onCopy(presentation)} type="button">
            <span aria-live="polite">{copied ? 'Link copied' : 'Copy link'}</span>
          </button>
        )}
      </div>
      {renameOpen && (
        <RenamePublicationDialog
          onClose={() => setRenameOpen(false)}
          onRename={(name) => onRename(presentation, name)}
          presentation={presentation}
        />
      )}
      {accessOpen && (
        <PresentationAccessDialog
          onClose={() => setAccessOpen(false)}
          onSaved={onAccessSaved}
          presentation={presentation}
        />
      )}
    </article>
  )
}
