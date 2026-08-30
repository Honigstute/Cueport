import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PresentationDocument } from '../../../../src/shared/presentation'
import { Stage } from '../../../../src/renderer/src/components/Stage'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { copyTextToClipboard } from '../../../../src/renderer/src/lib/clipboard'
import { nextZoomStop } from '../../../../src/renderer/src/lib/zoom'
import type { BrandSettings, DisplayMode, ReferenceAsset, SlideAsset } from '../../../../src/renderer/src/types'
import { PublicationCard, type PublishedPresentation } from './PublicationCard'
import { ViewerControls } from './ViewerControls'
import { AccountManagerDialog } from './AccountManagerDialog'
import { AccountMenu } from './AccountMenu'
import { CommentLayer, type CommentLayerHandle } from './CommentLayer'
import { ProfileDialog } from './ProfileDialog'
import { api } from './api'
import type { SessionResponse, UserProfile } from './accountTypes'

interface SharedPresentationResponse {
  document: PresentationDocument
  assets: Record<string, string>
}

interface ViewerSettings {
  mode: DisplayMode
  viewportEnabled: boolean
  viewportMarker: number | null
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))
}

function Brand(): React.JSX.Element {
  return (
    <div className="web-brand" aria-label="Cueport">
      <span><Icon name="target" size={18} /></span>
      <strong>cueport</strong>
    </div>
  )
}

function AccountForm({ mode, token, onSuccess }: {
  mode: 'login' | 'setup' | 'activate'
  token?: string
  onSuccess: (user: UserProfile) => void
}): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [invitedName, setInvitedName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mode !== 'activate' || !token) return
    let active = true
    api<{ email: string; displayName: string }>(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then((invite) => {
        if (!active) return
        setEmail(invite.email)
        setInvitedName(invite.displayName)
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : 'This account setup link is unavailable.'))
    return () => { active = false }
  }, [mode, token])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (mode !== 'login' && password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const endpoint = mode === 'setup' ? '/api/auth/setup' : mode === 'activate' ? '/api/auth/activate' : '/api/auth/login'
      const result = await api<{ user: UserProfile }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(mode === 'login' ? { email, password } : { token, password })
      })
      onSuccess(result.user)
      if (mode !== 'login') history.replaceState(null, '', '/')
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
        <span className="web-eyebrow">Cueport account</span>
        <h1>{mode === 'setup' ? 'Create your owner password' : mode === 'activate' ? `Welcome${invitedName ? `, ${invitedName}` : ''}` : 'Sign in to Cueport'}</h1>
        <p>{mode === 'setup'
          ? 'This finishes the protected owner account on your server.'
          : mode === 'activate'
            ? `Create a password for ${email || 'your invited account'}.`
            : 'Open private presentations and join discussions.'}</p>
        {mode === 'login' && (
          <label>
            <span>Email</span>
            <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
          </label>
        )}
        <label>
          <span>Password</span>
          <input
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {mode !== 'login' && (
          <label>
            <span>Repeat password</span>
            <input autoComplete="new-password" minLength={12} onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} />
          </label>
        )}
        {error && <p className="web-error" role="alert">{error}</p>}
        <button className="web-primary" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'setup' ? 'Create owner account' : mode === 'activate' ? 'Activate account' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

function Dashboard({ onLogout, onProfileChange, profile }: {
  onLogout: () => void
  onProfileChange: (profile: UserProfile) => void
  profile: UserProfile
}): React.JSX.Element {
  const [presentations, setPresentations] = useState<PublishedPresentation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)

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

  const remove = async (presentation: PublishedPresentation): Promise<void> => {
    if (!confirm(`Permanently delete “${presentation.name}” and all uploaded revisions?`)) return
    await api(`/api/presentations/${presentation.id}`, { method: 'DELETE', body: '{}' })
    await refresh()
  }

  const rename = async (presentation: PublishedPresentation, name: string): Promise<void> => {
    await api(`/api/presentations/${presentation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    })
    await refresh()
  }

  const takeOffline = async (presentation: PublishedPresentation): Promise<void> => {
    if (!confirm(`Take the private link for “${presentation.name}” offline? Anyone using it will lose access until you publish the presentation again.`)) return
    try {
      await api(`/api/presentations/${presentation.id}/revoke`, { method: 'POST', body: '{}' })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The private link could not be taken offline.')
    }
  }

  const copy = async (presentation: PublishedPresentation): Promise<void> => {
    if (!presentation.shareUrl) return
    setCopyMessage(null)
    try {
      await copyTextToClipboard(presentation.shareUrl)
      setCopiedId(presentation.id)
      setCopyMessage('Private link copied.')
      window.setTimeout(() => {
        setCopiedId((current) => current === presentation.id ? null : current)
        setCopyMessage(null)
      }, 2200)
    } catch (cause) {
      setCopiedId(null)
      setCopyMessage(cause instanceof Error ? cause.message : 'The private link could not be copied.')
    }
  }

  return (
    <main className="dashboard-screen">
      <header className="dashboard-header">
        <Brand />
        <AccountMenu onAccounts={() => setAccountsOpen(true)} onLogout={onLogout} onProfile={() => setProfileOpen(true)} profile={profile} />
      </header>
      <section className="dashboard-content">
        {error && <p className="web-error" role="alert">{error}</p>}
        {copyMessage && <p className={copiedId ? 'web-notice' : 'web-error'} role="status">{copyMessage}</p>}
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
              <PublicationCard
                copied={copiedId === presentation.id}
                key={presentation.id}
                onCopy={(item) => void copy(item)}
                onDelete={(item) => void remove(item)}
                onRename={rename}
                onTakeOffline={(item) => void takeOffline(item)}
                presentation={presentation}
              />
            ))}
          </div>
        )}
      </section>
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} onSaved={onProfileChange} profile={profile} />}
      {accountsOpen && <AccountManagerDialog onClose={() => setAccountsOpen(false)} />}
    </main>
  )
}

function MemberHome({ onLogout, onProfileChange, profile }: {
  onLogout: () => void
  onProfileChange: (profile: UserProfile) => void
  profile: UserProfile
}): React.JSX.Element {
  const [profileOpen, setProfileOpen] = useState(false)
  return (
    <main className="dashboard-screen member-home">
      <header className="dashboard-header">
        <Brand />
        <AccountMenu onLogout={onLogout} onProfile={() => setProfileOpen(true)} profile={profile} />
      </header>
      <section className="member-home-message">
        <Icon name="layers" size={24} />
        <strong>Open a private presentation link</strong>
        <span>Your Cueport account is ready. Use a link shared by the presentation owner to view layouts and join discussions.</span>
      </section>
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} onSaved={onProfileChange} profile={profile} />}
    </main>
  )
}

function SharedViewer({ token }: { token: string }): React.JSX.Element {
  const [shared, setShared] = useState<SharedPresentationResponse | null>(null)
  const [view, setView] = useState<ViewerSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(0)
  const [isInterfaceVisible, setIsInterfaceVisible] = useState(true)
  const [commentsEnabled, setCommentsEnabled] = useState(false)
  const commentLayerRef = useRef<CommentLayerHandle>(null)

  useEffect(() => {
    let active = true
    setShared(null)
    setView(null)
    setError(null)
    setActiveIndex(0)
    setZoom(1)
    setIsInterfaceVisible(true)
    setCommentsEnabled(false)
    api<SharedPresentationResponse>(`/api/share/${encodeURIComponent(token)}`)
      .then((response) => {
        if (!active) return
        setShared(response)
        setView({
          mode: response.document.settings.mode,
          viewportEnabled: response.document.settings.viewportEnabled,
          viewportMarker: response.document.settings.viewportMarker
        })
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'This presentation is unavailable.')
      })
    return () => { active = false }
  }, [token])

  const assets = useMemo(() => {
    if (!shared) return { slides: [] as SlideAsset[], references: [] as ReferenceAsset[], brand: null as BrandSettings | null }
    const media = (item: PresentationDocument['slides'][number]): SlideAsset => {
      const url = shared.assets[item.assetKey] || ''
      return {
        id: item.id,
        name: item.name,
        width: item.width,
        height: item.height,
        mimeType: item.mimeType,
        origin: 'local',
        sourceKey: null,
        url,
        // Images are already suitable previews. Videos use their uploaded poster.
        thumbnailUrl: item.posterKey
          ? shared.assets[item.posterKey] || ''
          : item.mimeType.startsWith('image/') ? url : ''
      }
    }
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

  const zoomBy = useCallback((direction: -1 | 1): void => {
    setView((current) => current ? { ...current, mode: 'canvas' } : current)
    setZoom((current) => nextZoomStop(current, direction))
  }, [])

  const createCommentAt = useCallback((clientX: number, clientY: number): void => {
    setIsInterfaceVisible(true)
    setCommentsEnabled(true)
    commentLayerRef.current?.openComposerAt(clientX, clientY)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.isComposing || isTextEntry(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(-1) }
      if (event.key === 'ArrowRight') { event.preventDefault(); navigate(1) }
      if (event.key.toLowerCase() === 'h') {
        event.preventDefault()
        if (!event.repeat) setIsInterfaceVisible((visible) => !visible)
        return
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        if (!event.repeat) setCommentsEnabled((enabled) => !enabled)
        return
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setView((current) => current ? { ...current, mode: 'canvas' } : current)
      }
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault()
        setView((current) => current ? { ...current, mode: 'fit-width' } : current)
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        setView((current) => current?.mode === 'canvas'
          ? { ...current, viewportEnabled: !current.viewportEnabled }
          : current)
      }
      if (event.key === '0') {
        event.preventDefault()
        setView((current) => current ? { ...current, mode: 'canvas' } : current)
        setZoom(1)
      }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1) }
      if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, zoomBy])

  if (error) return <main className="share-message"><Brand /><h1>Presentation unavailable</h1><p>{error}</p></main>
  if (!shared || !assets.brand || !view) return <main className="share-message"><Brand /><p>Loading presentation…</p></main>
  const settings = shared.document.settings
  const slide = assets.slides[activeIndex] ?? assets.slides[0] ?? null

  return (
    <div className={`public-viewer-shell app-shell${isInterfaceVisible ? '' : ' web-viewer-interface-hidden'}`}>
      <ViewerControls
        commentsEnabled={commentsEnabled}
        isVisible={isInterfaceVisible}
        mode={view.mode}
        onCommentsToggle={() => setCommentsEnabled((enabled) => !enabled)}
        onModeChange={(mode) => setView((current) => current ? { ...current, mode } : current)}
        onViewportMarkerChange={(viewportMarker) => setView((current) => current ? { ...current, viewportMarker } : current)}
        onViewportToggle={() => setView((current) => current ? { ...current, viewportEnabled: !current.viewportEnabled } : current)}
        onZoomReset={() => setZoom(1)}
        viewportEnabled={view.viewportEnabled}
        viewportHeight={settings.viewport.height}
        viewportMarker={view.viewportMarker}
        zoom={zoom}
      />
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
          mode={view.mode}
          onChooseMedia={() => undefined}
          onFitWidthChange={(_slideId, width) => setFitWidth(width)}
          onNavigate={navigate}
          onCreateCommentAt={createCommentAt}
          onZoomChange={setZoom}
          phoneBrowserBars={settings.phoneBrowserBars}
          programBarColor={settings.programBarColor}
          referenceImageShadow={settings.referenceImageShadow}
          references={assets.references}
          slide={slide}
          viewport={settings.viewport}
          viewportEnabled={view.viewportEnabled}
          viewportMarker={view.viewportMarker}
          zoom={view.mode === 'fit-width' && fitWidth ? 1 : zoom}
          artworkOverlay={slide ? (
            <CommentLayer
              enabled={commentsEnabled && isInterfaceVisible}
              ref={commentLayerRef}
              shareToken={token}
              slideId={slide.id}
            />
          ) : null}
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
  const query = new URLSearchParams(location.search)
  const setupToken = query.get('setup') || undefined
  const activationToken = query.get('activate') || undefined

  useEffect(() => {
    api<SessionResponse>('/api/session').then(setSession).catch(() => setSession({ authenticated: false }))
  }, [shareMatch?.[1]])

  if (!session) return <main className="share-message"><Brand /><p>Loading Cueport…</p></main>
  if (activationToken) {
    return <AccountForm mode="activate" onSuccess={(user) => setSession({ authenticated: true, user })} token={activationToken} />
  }
  if (!session.authenticated) {
    return <AccountForm mode={setupToken ? 'setup' : 'login'} onSuccess={(user) => setSession({ authenticated: true, user })} token={setupToken} />
  }
  if (!session.user) return <main className="share-message"><Brand /><p>Your account could not be loaded.</p></main>
  if (shareMatch) return <SharedViewer token={decodeURIComponent(shareMatch[1])} />

  const logout = (): void => {
    void api('/api/auth/logout', { method: 'POST', body: '{}' }).finally(() => setSession({ authenticated: false }))
  }
  const updateProfile = (user: UserProfile): void => setSession({ authenticated: true, user })

  return session.user.role === 'owner'
    ? <Dashboard onLogout={logout} onProfileChange={updateProfile} profile={session.user} />
    : <MemberHome onLogout={logout} onProfileChange={updateProfile} profile={session.user} />
}
