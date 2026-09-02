import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PublishingStatus } from '../../../shared/projects'
import { Icon } from './Icon'

interface PublishingAccountDialogProps {
  initialStatus: PublishingStatus | null
  onClose: () => void
  onStatusChange: (status: PublishingStatus) => void
}

function cleanError(cause: unknown, fallback: string): string {
  return cause instanceof Error
    ? cause.message.replace(/^Error invoking remote method '[^']+': /, '')
    : fallback
}

export function PublishingAccountDialog({
  initialStatus,
  onClose,
  onStatusChange
}: PublishingAccountDialogProps): React.JSX.Element {
  const [status, setStatus] = useState<PublishingStatus | null>(initialStatus)
  const [serverUrl, setServerUrl] = useState(initialStatus?.serverUrl ?? 'https://cueport.steveschreiner.de')
  const [email, setEmail] = useState(initialStatus?.email ?? 'stevedotschreiner@gmail.com')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status || !window.cueport) return
    window.cueport.getPublishingStatus()
      .then((next) => {
        setStatus(next)
        setServerUrl(next.serverUrl)
        if (next.email) setEmail(next.email)
        onStatusChange(next)
      })
      .catch((cause) => setError(cleanError(cause, 'The desktop account could not be loaded.')))
  }, [onStatusChange, status])

  const signIn = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!window.cueport) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.cueport.signInToPublishing({ serverUrl, email, password })
      setStatus(next)
      setPassword('')
      onStatusChange(next)
    } catch (cause) {
      setError(cleanError(cause, 'Cueport could not sign in to the server.'))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    if (!window.cueport) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.cueport.signOutOfPublishing()
      setStatus(next)
      setServerUrl(next.serverUrl)
      setEmail(next.email ?? '')
      onStatusChange(next)
    } catch (cause) {
      setError(cleanError(cause, 'Cueport could not sign out.'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop publishing-account-backdrop"
      onKeyDown={(event) => event.key === 'Escape' && !busy && onClose()}
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <section aria-labelledby="publishing-account-title" aria-modal="true" className="rename-dialog publishing-account-dialog" role="dialog">
        <div className="publishing-account-heading">
          <div className="rename-dialog-copy">
            <span className="eyebrow">Desktop account</span>
            <h2 id="publishing-account-title">Cueport account</h2>
          </div>
          <button aria-label="Close account" className="icon-button" disabled={busy} onClick={onClose} type="button">
            <Icon name="close" size={16} />
          </button>
        </div>

        {!status ? (
          <p className="publish-status">Loading account…</p>
        ) : status.signedIn ? (
          <div className="publishing-account-signed-in">
            <span className="publishing-account-icon"><Icon name="user" size={18} /></span>
            <div>
              <strong>{status.email}</strong>
              <small>Signed in for publishing on this Mac</small>
            </div>
            <p>Local presentations always remain available offline. The server is only needed when you publish or manage online access.</p>
            {error && <p className="field-error rename-error" role="alert">{error}</p>}
            <div className="rename-dialog-actions">
              <button disabled={busy} onClick={onClose} type="button">Close</button>
              <button className="primary" disabled={busy} onClick={() => void signOut()} type="button">{busy ? 'Signing out…' : 'Sign out'}</button>
            </div>
          </div>
        ) : (
          <form className="publish-login" onSubmit={(event) => void signIn(event)}>
            <p className="publishing-account-offline-note">Sign in once to publish. Opening, editing, and saving local presentations never requires an internet connection.</p>
            <label className="rename-field">
              <span>Server</span>
              <span className="rename-input-shell"><input disabled={busy} onChange={(event) => setServerUrl(event.target.value)} value={serverUrl} /></span>
            </label>
            <label className="rename-field">
              <span>Email</span>
              <span className="rename-input-shell"><input autoComplete="email" disabled={busy} onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></span>
            </label>
            <label className="rename-field">
              <span>Password</span>
              <span className="rename-input-shell"><input autoComplete="current-password" disabled={busy} onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></span>
            </label>
            {error && <p className="field-error rename-error" role="alert">{error}</p>}
            <div className="rename-dialog-actions">
              <button disabled={busy} onClick={onClose} type="button">Cancel</button>
              <button className="primary" disabled={busy || !password} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body
  )
}
