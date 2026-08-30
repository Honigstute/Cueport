import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PresentationDocument } from '../../../../src/shared/presentation'
import { Stage } from '../../../../src/renderer/src/components/Stage'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import type { BrandSettings, ReferenceAsset, SlideAsset } from '../../../../src/renderer/src/types'

interface SessionResponse {
  authenticated: boolean
  email?: string
}

interface PublishedPresentation {
  id: string
  name: string
  updatedAt: string
  revisionNumber: number | null
  slideCount: number
  shareUrl: string | null
}

interface SharedPresentationResponse {
  document: PresentationDocument
  assets: Record<string, string>
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers
    }
  })
  const body = await response.json().catch(() => null) as { error?: string } | null
  if (!response.ok) throw new Error(body?.error || 'Cueport could not complete that request.')
  return body as T
}

function Brand(): React.JSX.Element {
  return (
    <div className="web-brand" aria-label="Cueport">
      <span><Icon name="target" size={18} /></span>
      <strong>cueport</strong>
    </div>
  )
}

function AccountForm({ mode, setupToken, onSuccess }: {
  mode: 'login' | 'setup'
  setupToken?: string
  onSuccess: (email: string) => void
}): React.JSX.Element {
  const [email, setEmail] = useState('stevedotschreiner@gmail.com')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (mode === 'setup' && password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ email: string }>(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(mode === 'setup'
          ? { token: setupToken, password }
          : { email, password })
      })
      onSuccess(result.email)
      history.replaceState(null, '', '/')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="account-screen">
      <Brand />
      <form className="account-card" onSubmit={(event) => void submit(event)}>
        <span className="web-eyebrow">Owner access</span>
        <h1>{mode === 'setup' ? 'Create your Cueport password' : 'Sign in to Cueport'}</h1>
        <p>{mode === 'setup'
          ? 'This finishes the private owner account on your server.'
          : 'Manage published presentations and private client links.'}</p>
        {mode === 'login' && (
          <label>
            <span>Email</span>
            <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </label>
        )}
        <label>
          <span>Password</span>
          <input
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {mode === 'setup' && (
          <label>
            <span>Repeat password</span>
            <input autoComplete="new-password" minLength={12} onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} />
          </label>
        )}
        {error && <p className="web-error" role="alert">{error}</p>}
        <button className="web-primary" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'setup' ? 'Create owner account' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

function Dashboard({ email, onLogout }: { email: string; onLogout: () => void }): React.JSX.Element {
  const [presentations, setPresentations] = useState<PublishedPresentation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await api<{ presentations: PublishedPresentation[] }>('/api/presentations')
      setPresentations(result.presentations)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Presentations could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const revoke = async (presentation: PublishedPresentation): Promise<void> => {
    if (!presentation.shareUrl || !confirm(`Disable the client link for “${presentation.name}”?`)) return
    await api(`/api/presentations/${presentation.id}/revoke`, { method: 'POST', body: '{}' })
    await refresh()
  }

  const remove = async (presentation: PublishedPresentation): Promise<void> => {
    if (!confirm(`Permanently delete “${presentation.name}” and all uploaded revisions?`)) return
    await api(`/api/presentations/${presentation.id}`, { method: 'DELETE', body: '{}' })
    await refresh()
  }

  const copy = async (presentation: PublishedPresentation): Promise<void> => {
    if (!presentation.shareUrl) return
    await navigator.clipboard.writeText(presentation.shareUrl)
    setCopiedId(presentation.id)
    window.setTimeout(() => setCopiedId((current) => current === presentation.id ? null : current), 1800)
  }

  return (
    <main className="dashboard-screen">
      <header className="dashboard-header">
        <Brand />
        <div>
          <span>{email}</span>
          <button onClick={onLogout} type="button">Sign out</button>
        </div>
      </header>
      <section className="dashboard-content">
        <div className="dashboard-heading">
          <div>
            <span className="web-eyebrow">Private publishing</span>
            <h1>Presentations</h1>
            <p>Publish or update a presentation from the Cueport desktop app.</p>
          </div>
          <button className="web-secondary" onClick={() => void refresh()} type="button">Refresh</button>
        </div>
        {error && <p className="web-error" role="alert">{error}</p>}
        {loading ? (
          <div className="dashboard-empty">Loading presentations…</div>
        ) : presentations.length === 0 ? (
          <div className="dashboard-empty">
            <Icon name="upload" size={24} />
            <strong>No presentation has been published yet.</strong>
            <span>Open one in the desktop app and choose Publish.</span>
          </div>
        ) : (
          <div className="publication-grid">
            {presentations.map((presentation) => (
              <article className="publication-card" key={presentation.id}>
                <div className="publication-preview">
                  <span>{presentation.slideCount}</span>
                  <Icon name="layers" size={28} />
                </div>
                <div className="publication-copy">
                  <h2>{presentation.name}</h2>
                  <p>Revision {presentation.revisionNumber ?? '—'} · {presentation.slideCount} {presentation.slideCount === 1 ? 'screen' : 'screens'}</p>
                  <time dateTime={presentation.updatedAt}>{new Date(presentation.updatedAt).toLocaleString()}</time>
                </div>
                <div className="publication-actions">
                  {presentation.shareUrl ? (
                    <>
                      <button className="web-primary" onClick={() => void copy(presentation)} type="button">
                        {copiedId === presentation.id ? 'Copied' : 'Copy link'}
                      </button>
                      <a href={presentation.shareUrl} rel="noreferrer" target="_blank">Open</a>
                      <button onClick={() => void revoke(presentation)} type="button">Disable link</button>
                    </>
                  ) : <span className="publication-revoked">Link disabled — publish again to create a new one.</span>}
                  <button className="danger" onClick={() => void remove(presentation)} type="button">Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function SharedViewer({ token }: { token: string }): React.JSX.Element {
  const [shared, setShared] = useState<SharedPresentationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(0)

  useEffect(() => {
    api<SharedPresentationResponse>(`/api/share/${encodeURIComponent(token)}`)
      .then(setShared)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'This presentation is unavailable.'))
  }, [token])

  const assets = useMemo(() => {
    if (!shared) return { slides: [] as SlideAsset[], references: [] as ReferenceAsset[], brand: null as BrandSettings | null }
    const media = (item: PresentationDocument['slides'][number]): SlideAsset => ({
      id: item.id,
      name: item.name,
      width: item.width,
      height: item.height,
      mimeType: item.mimeType,
      origin: 'local',
      sourceKey: null,
      url: shared.assets[item.assetKey] || '',
      thumbnailUrl: item.posterKey ? shared.assets[item.posterKey] || '' : ''
    })
    return {
      slides: shared.document.slides.map(media),
      references: shared.document.references.map(media),
      brand: shared.document.brand ? {
        ...shared.document.settings.brand,
        logoName: shared.document.brand.name,
        logoSourceKey: null,
        logoUrl: shared.assets[shared.document.brand.assetKey] || null
      } : { ...shared.document.settings.brand, logoName: null, logoSourceKey: null, logoUrl: null }
    }
  }, [shared])

  const navigate = useCallback((direction: -1 | 1): void => {
    setActiveIndex((current) => Math.max(0, Math.min(assets.slides.length - 1, current + direction)))
  }, [assets.slides.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(-1) }
      if (event.key === 'ArrowRight') { event.preventDefault(); navigate(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  if (error) return <main className="share-message"><Brand /><h1>Presentation unavailable</h1><p>{error}</p></main>
  if (!shared || !assets.brand) return <main className="share-message"><Brand /><p>Loading presentation…</p></main>
  const settings = shared.document.settings
  const slide = assets.slides[activeIndex] ?? assets.slides[0] ?? null

  return (
    <div className="public-viewer-shell app-shell chrome-hidden">
      <div className="workspace">
        <Stage
          background={settings.background}
          brand={assets.brand}
          canNavigateNext={activeIndex < assets.slides.length - 1}
          canNavigatePrevious={activeIndex > 0}
          canvasFrame={settings.canvasFrame}
          canvasImageGlow={settings.canvasImageGlow}
          canvasRoundedCorners={settings.canvasRoundedCorners}
          canvasStartAtTop={settings.canvasStartAtTop}
          chromeMode="hidden"
          isImporting={false}
          mode={settings.mode}
          onChooseMedia={() => undefined}
          onFitWidthChange={(_slideId, width) => setFitWidth(width)}
          onNavigate={navigate}
          onZoomChange={setZoom}
          phoneBrowserBars={settings.phoneBrowserBars}
          programBarColor={settings.programBarColor}
          referenceImageShadow={settings.referenceImageShadow}
          references={assets.references}
          slide={slide}
          viewport={settings.viewport}
          viewportEnabled={settings.viewportEnabled}
          viewportMarker={settings.viewportMarker}
          zoom={settings.mode === 'fit-width' && fitWidth ? 1 : zoom}
        />
      </div>
      {assets.slides.length > 1 && (
        <div className="viewer-counter" aria-live="polite">{activeIndex + 1} / {assets.slides.length}</div>
      )}
    </div>
  )
}

export default function App(): React.JSX.Element {
  const shareMatch = location.pathname.match(/^\/p\/([^/]+)$/)
  const [session, setSession] = useState<SessionResponse | null>(null)
  const setupToken = new URLSearchParams(location.search).get('setup') || undefined

  useEffect(() => {
    if (shareMatch) return
    api<SessionResponse>('/api/session').then(setSession).catch(() => setSession({ authenticated: false }))
  }, [shareMatch?.[1]])

  if (shareMatch) return <SharedViewer token={decodeURIComponent(shareMatch[1])} />
  if (!session) return <main className="share-message"><Brand /><p>Loading Cueport…</p></main>
  if (!session.authenticated) {
    return <AccountForm mode={setupToken ? 'setup' : 'login'} onSuccess={(email) => setSession({ authenticated: true, email })} setupToken={setupToken} />
  }
  return <Dashboard email={session.email || 'Owner'} onLogout={() => {
    void api('/api/auth/logout', { method: 'POST', body: '{}' }).finally(() => setSession({ authenticated: false }))
  }} />
}
