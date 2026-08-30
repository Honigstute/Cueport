import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { copyTextToClipboard } from '../../../../src/renderer/src/lib/clipboard'
import { api } from './api'
import type { AccountSummary } from './accountTypes'
import { prepareAvatarDataUrl } from './avatar'
import { trapDialogFocus } from './dialogFocus'
import { ProfileAvatar } from './ProfileAvatar'

interface AccountDraft {
  avatarDataUrl?: string | null
  displayName: string
  email: string
  title: string
}

const EMPTY_DRAFT: AccountDraft = { displayName: '', email: '', title: '' }

function AccountEditor({ account, onCancel, onSaved }: {
  account: AccountSummary | null
  onCancel: () => void
  onSaved: (setupUrl?: string) => void
}): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<AccountDraft>(account ? {
    displayName: account.displayName,
    email: account.email,
    title: account.title
  } : EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = {
    displayName: draft.displayName || 'New account',
    avatarUrl: draft.avatarDataUrl === undefined ? account?.avatarUrl ?? null : draft.avatarDataUrl
  }

  const chooseAvatar = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      const avatarDataUrl = await prepareAvatarDataUrl(file)
      setDraft((current) => ({ ...current, avatarDataUrl }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The profile picture could not be prepared.')
    }
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (account) {
        await api(`/api/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(draft) })
        onSaved()
      } else {
        const result = await api<{ setupUrl: string }>('/api/accounts', { method: 'POST', body: JSON.stringify(draft) })
        onSaved(result.setupUrl)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The account could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="account-editor" onSubmit={(event) => void submit(event)}>
      <div className="account-editor-heading"><strong>{account ? 'Edit account' : 'Add account'}</strong><button aria-label="Close editor" className="icon-button" onClick={onCancel} type="button"><Icon name="close" size={15} /></button></div>
      <div className="profile-avatar-editor compact">
        <ProfileAvatar profile={preview} size={58} />
        <div>
          <button className="web-secondary" onClick={() => fileRef.current?.click()} type="button"><Icon name="camera" size={15} />Choose picture</button>
          {preview.avatarUrl && <button className="profile-remove-avatar" onClick={() => setDraft((current) => ({ ...current, avatarDataUrl: null }))} type="button">Remove</button>}
        </div>
        <input accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void chooseAvatar(event.target.files?.[0])} ref={fileRef} type="file" />
      </div>
      <label className="account-field"><span>Email</span><input autoFocus={!account?.protected} disabled={account?.protected} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} required type="email" value={draft.email} /></label>
      <label className="account-field"><span>Name</span><input autoFocus={Boolean(account?.protected)} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} required value={draft.displayName} /></label>
      <label className="account-field"><span>Title</span><input maxLength={100} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Client reviewer" value={draft.title} /></label>
      {error && <p className="web-error" role="alert">{error}</p>}
      <div className="account-dialog-actions"><button className="web-secondary" onClick={onCancel} type="button">Cancel</button><button className="web-primary" disabled={busy} type="submit">{busy ? 'Saving…' : account ? 'Save account' : 'Create account'}</button></div>
    </form>
  )
}

export function AccountManagerDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [editing, setEditing] = useState<AccountSummary | 'new' | null>(null)
  const [setupUrl, setSetupUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const editorReturnFocusRef = useRef<HTMLButtonElement | null>(null)

  const closeEditor = useCallback((): void => {
    setEditing(null)
    window.requestAnimationFrame(() => {
      const preferred = editorReturnFocusRef.current
      const target = preferred?.isConnected ? preferred : addButtonRef.current
      if (target?.isConnected) target.focus()
      editorReturnFocusRef.current = null
    })
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await api<{ accounts: AccountSummary[] }>('/api/accounts')
      setAccounts(result.accounts)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Accounts could not be loaded.')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (editing) closeEditor()
      else onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [closeEditor, editing, onClose])

  const remove = async (account: AccountSummary): Promise<void> => {
    if (!confirm(`Delete the account for ${account.displayName}? Their previous comments will remain as “Deleted account”.`)) return
    try {
      await api(`/api/accounts/${account.id}`, { method: 'DELETE', body: '{}' })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The account could not be deleted.')
    }
  }

  const invite = async (account: AccountSummary): Promise<void> => {
    try {
      const result = await api<{ setupUrl: string }>(`/api/accounts/${account.id}/invite`, { method: 'POST', body: '{}' })
      setSetupUrl(result.setupUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A setup link could not be created.')
    }
  }

  const copySetupUrl = async (): Promise<void> => {
    if (!setupUrl) return
    try {
      await copyTextToClipboard(setupUrl)
      setError(null)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The setup link could not be copied.')
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !editing && onClose()}>
      <section aria-labelledby="accounts-title" aria-modal="true" className="account-dialog accounts-dialog" onKeyDown={trapDialogFocus} role="dialog">
        <header className="account-dialog-header">
          <div><span className="eyebrow">Administration</span><h2 id="accounts-title">Accounts</h2></div>
          <div className="account-dialog-header-actions"><button autoFocus className="web-primary" onClick={(event) => { editorReturnFocusRef.current = event.currentTarget; setSetupUrl(null); setEditing('new') }} ref={addButtonRef} type="button"><Icon name="add" size={15} />Add account</button><button aria-label="Close accounts" className="icon-button" onClick={onClose} type="button"><Icon name="close" size={16} /></button></div>
        </header>
        {error && <p className="web-error" role="alert">{error}</p>}
        {setupUrl && (
          <div className="setup-link-result">
            <div><strong>Account setup link</strong><span>Send this private link to the account owner. It expires in seven days.</span></div>
            <input aria-label="Account setup link" readOnly value={setupUrl} />
            <button className="web-primary" onClick={() => void copySetupUrl()} type="button">{copied ? 'Copied' : 'Copy setup link'}</button>
          </div>
        )}
        {editing ? (
          <AccountEditor
            account={editing === 'new' ? null : editing}
            onCancel={closeEditor}
            onSaved={(url) => { closeEditor(); if (url) setSetupUrl(url); void refresh() }}
          />
        ) : (
          <div className="account-list">
            {accounts.map((account) => (
              <article className="account-row" key={account.id}>
                <ProfileAvatar profile={account} size={44} />
                <div className="account-row-copy"><strong>{account.displayName}</strong><span>{account.title || account.email}</span><small>{account.protected ? 'Owner' : account.active ? account.email : `${account.email} · Setup pending`}</small></div>
                <div className="account-row-actions">
                  <button aria-label={`Edit ${account.displayName}`} className="icon-button" onClick={(event) => { editorReturnFocusRef.current = event.currentTarget; setSetupUrl(null); setEditing(account) }} title="Edit account" type="button"><Icon name="edit" size={15} /></button>
                  {!account.protected && <button aria-label={`Create setup link for ${account.displayName}`} className="icon-button" onClick={() => void invite(account)} title="Create setup link" type="button"><Icon name="send" size={15} /></button>}
                  {!account.protected && <button aria-label={`Delete ${account.displayName}`} className="icon-button account-delete" onClick={() => void remove(account)} title="Delete account" type="button"><Icon name="remove" size={15} /></button>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>,
    document.body
  )
}
