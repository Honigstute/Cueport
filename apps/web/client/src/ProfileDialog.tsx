import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { api } from './api'
import type { UserProfile } from './accountTypes'
import { prepareAvatarDataUrl } from './avatar'
import { trapDialogFocus } from './dialogFocus'
import { ProfileAvatar } from './ProfileAvatar'

export function ProfileDialog({ profile, onClose, onSaved }: {
  profile: UserProfile
  onClose: () => void
  onSaved: (profile: UserProfile) => void
}): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [title, setTitle] = useState(profile.title)
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = { displayName, avatarUrl: avatarDataUrl === undefined ? profile.avatarUrl : avatarDataUrl }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, onClose])

  const chooseAvatar = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      setError(null)
      setAvatarDataUrl(await prepareAvatarDataUrl(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The profile picture could not be prepared.')
    }
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ user: UserProfile }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName,
          title,
          ...(avatarDataUrl !== undefined ? { avatarDataUrl } : {})
        })
      })
      onSaved(result.user)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The profile could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <form aria-labelledby="profile-dialog-title" aria-modal="true" className="account-dialog profile-dialog" onKeyDown={trapDialogFocus} onSubmit={(event) => void submit(event)} role="dialog">
        <header className="account-dialog-header">
          <div>
            <span className="eyebrow">Account</span>
            <h2 id="profile-dialog-title">Your profile</h2>
          </div>
          <button aria-label="Close profile" className="icon-button" disabled={busy} onClick={onClose} type="button"><Icon name="close" size={16} /></button>
        </header>
        <div className="profile-avatar-editor">
          <ProfileAvatar profile={preview} size={72} />
          <div>
            <button className="web-secondary" onClick={() => fileRef.current?.click()} type="button"><Icon name="camera" size={15} />Choose picture</button>
            {preview.avatarUrl && <button className="profile-remove-avatar" onClick={() => setAvatarDataUrl(null)} type="button">Remove</button>}
          </div>
          <input accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void chooseAvatar(event.target.files?.[0])} ref={fileRef} type="file" />
        </div>
        <label className="account-field"><span>Name</span><input autoFocus maxLength={80} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} /></label>
        <label className="account-field"><span>Title</span><input maxLength={100} onChange={(event) => setTitle(event.target.value)} placeholder="Client reviewer" value={title} /></label>
        <p className="account-email-readonly">{profile.email}</p>
        {error && <p className="web-error" role="alert">{error}</p>}
        <footer className="account-dialog-actions">
          <button className="web-secondary" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="web-primary" disabled={busy || !displayName.trim()} type="submit">{busy ? 'Saving…' : 'Save profile'}</button>
        </footer>
      </form>
    </div>,
    document.body
  )
}
