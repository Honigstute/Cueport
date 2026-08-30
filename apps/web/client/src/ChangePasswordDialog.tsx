import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { api } from './api'
import { trapDialogFocus } from './dialogFocus'

export function ChangePasswordDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, onClose])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (newPassword !== confirmation) {
      setError('The two new passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api('/api/profile/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setChanged(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The password could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      {changed ? (
        <section aria-labelledby="password-changed-title" aria-modal="true" className="account-dialog password-dialog" onKeyDown={trapDialogFocus} role="dialog">
          <div className="password-result-icon"><Icon name="check" size={19} /></div>
          <h2 id="password-changed-title">Password changed</h2>
          <p className="password-dialog-copy">Your current browser remains signed in. Other browser sessions and Cueport desktop connections need to sign in again.</p>
          <div className="account-dialog-actions"><button autoFocus className="web-primary" onClick={onClose} type="button">Done</button></div>
        </section>
      ) : (
        <form aria-labelledby="change-password-title" aria-modal="true" className="account-dialog password-dialog" onKeyDown={trapDialogFocus} onSubmit={(event) => void submit(event)} role="dialog">
          <header className="account-dialog-header">
            <div><span className="eyebrow">Security</span><h2 id="change-password-title">Change password</h2></div>
            <button aria-label="Close password dialog" className="icon-button" disabled={busy} onClick={onClose} type="button"><Icon name="close" size={16} /></button>
          </header>
          <p className="password-dialog-copy">Use at least 12 characters. Changing your password signs out other browser sessions and Cueport desktop connections.</p>
          <div className="password-fields">
            <label className="account-field"><span>Current password</span><input autoComplete="current-password" autoFocus onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
            <label className="account-field"><span>New password</span><input autoComplete="new-password" minLength={12} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
            <label className="account-field"><span>Repeat new password</span><input autoComplete="new-password" minLength={12} onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} /></label>
          </div>
          {error && <p className="web-error" role="alert">{error}</p>}
          <footer className="account-dialog-actions">
            <button className="web-secondary" disabled={busy} onClick={onClose} type="button">Cancel</button>
            <button className="web-primary" disabled={busy || !currentPassword || newPassword.length < 12 || !confirmation} type="submit">{busy ? 'Changing…' : 'Change password'}</button>
          </footer>
        </form>
      )}
    </div>,
    document.body
  )
}
