import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import type { AssignableAccountRole } from '../../../../src/shared/accounts'
import type { PublishedPresentation } from './PublicationCard'
import { api } from './api'
import { trapDialogFocus } from './dialogFocus'

interface SharingAccount {
  id: string
  email: string
  displayName: string
  title: string
  role: AssignableAccountRole
  active: boolean
  granted: boolean
}

interface PresentationAccessResponse {
  isPublic: boolean
  accounts: SharingAccount[]
}

export function PresentationAccessDialog({
  presentation,
  onClose,
  onSaved
}: {
  presentation: PublishedPresentation
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [accounts, setAccounts] = useState<SharingAccount[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPublic, setIsPublic] = useState(presentation.isPublic)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [peopleQuery, setPeopleQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api<PresentationAccessResponse>(`/api/presentations/${presentation.id}/access`)
      .then((response) => {
        if (!active) return
        setAccounts(response.accounts)
        setSelected(new Set(response.accounts.filter((account) => account.granted).map((account) => account.id)))
        setIsPublic(response.isPublic)
        setLoading(false)
      })
      .catch((cause) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : 'Presentation access could not be loaded.')
        setLoading(false)
      })
    return () => { active = false }
  }, [presentation.id])

  const toggleAccount = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const normalizedPeopleQuery = peopleQuery.trim().toLocaleLowerCase()
  const visibleAccounts = normalizedPeopleQuery
    ? accounts.filter((account) => `${account.displayName} ${account.email}`.toLocaleLowerCase().includes(normalizedPeopleQuery))
    : accounts

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api(`/api/presentations/${presentation.id}/access`, {
        method: 'PUT',
        body: JSON.stringify({ isPublic, accountIds: [...selected] })
      })
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Presentation access could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <form
        aria-labelledby="presentation-access-title"
        aria-modal="true"
        className="account-dialog presentation-access-dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && peopleOpen) {
            event.preventDefault()
            setPeopleOpen(false)
          } else if (event.key === 'Escape' && !busy) onClose()
          else trapDialogFocus(event)
        }}
        onSubmit={(event) => void save(event)}
        role="dialog"
      >
        <header className="account-dialog-header">
          <div>
            <span className="eyebrow">Presentation access</span>
            <h2 id="presentation-access-title">Share “{presentation.name}”</h2>
          </div>
          <button aria-label="Close access settings" className="icon-button" disabled={busy} onClick={onClose} type="button">
            <Icon name="close" size={16} />
          </button>
        </header>

        {loading ? (
          <p className="presentation-access-loading">Loading access…</p>
        ) : (
          <>
            <button
              aria-checked={isPublic}
              className="presentation-access-toggle presentation-access-public"
              data-active={isPublic}
              onClick={() => setIsPublic((current) => !current)}
              role="switch"
              type="button"
            >
              <span>
                <strong>Anyone with the link</strong>
                <small>No Cueport account or sign-in required</small>
              </span>
              <span aria-hidden="true" className="toggle-track"><span className="toggle-thumb" /></span>
            </button>

            <section className="presentation-access-people" aria-labelledby="presentation-access-people-title">
              <button
                aria-controls="presentation-access-people-list"
                aria-expanded={peopleOpen}
                className="presentation-access-picker-trigger"
                disabled={accounts.length === 0}
                onClick={() => setPeopleOpen((current) => !current)}
                type="button"
              >
                <span className="presentation-access-picker-copy">
                  <strong id="presentation-access-people-title">People with dashboard access</strong>
                  <small>Choose who sees this presentation in Cueport</small>
                </span>
                <span className="presentation-access-picker-status">
                  <small>{selected.size} selected</small>
                  <Icon className="presentation-access-picker-chevron" name="chevron-down" size={15} />
                </span>
              </button>
              {accounts.length > 0 ? peopleOpen && (
                <div className="presentation-access-picker-panel" id="presentation-access-people-list">
                  {accounts.length > 6 && (
                    <label className="presentation-access-search">
                      <Icon name="zoom" size={15} />
                      <input
                        aria-label="Search people"
                        autoFocus
                        onChange={(event) => setPeopleQuery(event.target.value)}
                        onKeyDown={(event) => event.key === 'Enter' && event.preventDefault()}
                        placeholder="Search people"
                        type="search"
                        value={peopleQuery}
                      />
                    </label>
                  )}
                  <div aria-label="People with dashboard access" className="presentation-access-list" role="group">
                    {visibleAccounts.map((account) => {
                      const granted = selected.has(account.id)
                      return (
                        <button
                          aria-checked={granted}
                          className="presentation-access-toggle presentation-access-person"
                          data-active={granted}
                          key={account.id}
                          onClick={() => toggleAccount(account.id)}
                          role="switch"
                          type="button"
                        >
                          <span>
                            <strong>{account.displayName}</strong>
                            <small>{account.role[0].toUpperCase() + account.role.slice(1)} · {account.email}{account.active ? '' : ' · Setup pending'}</small>
                          </span>
                          <span aria-hidden="true" className="toggle-track"><span className="toggle-thumb" /></span>
                        </button>
                      )
                    })}
                    {visibleAccounts.length === 0 && (
                      <p className="presentation-access-no-results">No matching people</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="presentation-access-empty">Create another Cueport account first to share presentations directly to a dashboard.</p>
              )}
            </section>
          </>
        )}

        {error && <p className="web-error" role="alert">{error}</p>}
        <div className="account-dialog-actions">
          <button className="web-secondary" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="web-primary" disabled={busy || loading} type="submit">{busy ? 'Saving…' : 'Save access'}</button>
        </div>
      </form>
    </div>,
    document.body
  )
}
