import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PublishingResult, PublishingStatus } from '../../../shared/projects'
import { copyTextToClipboard } from '../lib/clipboard'

interface PublishDialogProps {
  presentationName: string
  isSaved: boolean
  isDirty: boolean
  onClose: () => void
  onPublish: () => Promise<PublishingResult>
}

function cleanError(cause: unknown, fallback: string): string {
  return cause instanceof Error
    ? cause.message.replace(/^Error invoking remote method '[^']+': /, '')
    : fallback
}

export function PublishDialog({ presentationName, isSaved, isDirty, onClose, onPublish }: PublishDialogProps): React.JSX.Element {
  const [status, setStatus] = useState<PublishingStatus | null>(null)
  const [serverUrl, setServerUrl] = useState('https://cueport.steveschreiner.de')
  const [email, setEmail] = useState('stevedotschreiner@gmail.com')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PublishingResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.cueport?.getPublishingStatus()
      .then((next) => {
        setStatus(next)
        setServerUrl(next.serverUrl)
        if (next.email) setEmail(next.email)
      })
      .catch((cause) => setError(cleanError(cause, 'Publishing settings could not be loaded.')))
  }, [])

  const signIn = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!window.cueport) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.cueport.signInToPublishing({ serverUrl, email, password })
      setStatus(next)
      setPassword('')
    } catch (cause) {
      setError(cleanError(cause, 'Cueport could not sign in to the publishing server.'))
    } finally {
      setBusy(false)
    }
  }

  const publish = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setResult(await onPublish())
    } catch (cause) {
      setError(cleanError(cause, 'The presentation could not be published.'))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    if (!window.cueport) return
    setBusy(true)
    try {
      setStatus(await window.cueport.signOutOfPublishing())
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async (): Promise<void> => {
    if (!result) return
    setError(null)
    try {
      await copyTextToClipboard(result.shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch (cause) {
      setError(cleanError(cause, 'The private link could not be copied.'))
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop publish-dialog-backdrop"
      onKeyDown={(event) => event.key === 'Escape' && !busy && onClose()}
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <section aria-labelledby="publish-dialog-title" aria-modal="true" className="rename-dialog publish-dialog" role="dialog">
        <div className="rename-dialog-copy">
          <span className="eyebrow">Private web link</span>
          <h2 id="publish-dialog-title">Publish presentation</h2>
          <p>{presentationName}</p>
        </div>

        {!status ? (
          <p className="publish-status">Loading publishing account…</p>
        ) : !status.signedIn ? (
          <form className="publish-login" onSubmit={(event) => void signIn(event)}>
            <label className="rename-field">
              <span>Server</span>
              <span className="rename-input-shell"><input disabled={busy} onChange={(event) => setServerUrl(event.target.value)} value={serverUrl} /></span>
            </label>
            <label className="rename-field">
              <span>Owner email</span>
              <span className="rename-input-shell"><input autoComplete="email" disabled={busy} onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></span>
            </label>
            <label className="rename-field">
              <span>Password</span>
              <span className="rename-input-shell"><input autoComplete="current-password" disabled={busy} onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></span>
            </label>
            {error && <p className="field-error rename-error">{error}</p>}
            <div className="rename-dialog-actions">
              <button disabled={busy} onClick={onClose} type="button">Cancel</button>
              <button className="primary" disabled={busy || !password} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
            </div>
          </form>
        ) : result ? (
          <div className="publish-result">
            <strong>Revision {result.revisionNumber} is live.</strong>
            <p>The private link can be copied now and disabled later from the web dashboard.</p>
            <input aria-label="Private presentation link" readOnly value={result.shareUrl} />
            {error && <p className="field-error rename-error">{error}</p>}
            <div className="rename-dialog-actions">
              <button onClick={onClose} type="button">Back to presentation</button>
              <button className="primary" onClick={() => void copyLink()} type="button">{copied ? 'Copied' : 'Copy link'}</button>
            </div>
          </div>
        ) : (
          <div className="publish-confirmation">
            <div className="publish-account-row">
              <span>Signed in as {status.email}</span>
              <button disabled={busy} onClick={() => void signOut()} type="button">Sign out</button>
            </div>
            <p>{isDirty ? 'Cueport will save your current changes first, then publish a new revision.' : 'Cueport will publish a new immutable revision of this saved presentation.'}</p>
            {!isSaved && <p className="field-error rename-error">Save this presentation on your computer before publishing it.</p>}
            {error && <p className="field-error rename-error">{error}</p>}
            <div className="rename-dialog-actions">
              <button disabled={busy} onClick={onClose} type="button">Cancel</button>
              <button className="primary" disabled={busy || !isSaved} onClick={() => void publish()} type="button">
                {busy ? (isDirty ? 'Saving and publishing…' : 'Publishing…') : 'Publish'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body
  )
}
