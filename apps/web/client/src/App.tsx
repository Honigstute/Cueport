import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PresentationDocument } from '../../../../src/shared/presentation'
import { Stage } from '../../../../src/renderer/src/components/Stage'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { useManagedTimeout } from '../../../../src/renderer/src/hooks/useManagedTimeout'
import { useAdjacentMediaPreload } from '../../../../src/renderer/src/hooks/useAdjacentMediaPreload'
import { copyTextToClipboard } from '../../../../src/renderer/src/lib/clipboard'
import { nextZoomStop } from '../../../../src/renderer/src/lib/zoom'
import type { BrandSettings, DisplayMode, ReferenceAsset, SlideAsset } from '../../../../src/renderer/src/types'
import { canEditPresentations, canManageAccounts } from '../../../../src/shared/accounts'
import { PublicationCard, type PublishedPresentation } from './PublicationCard'
import { ViewerControls } from './ViewerControls'
import { AccountManagerDialog } from './AccountManagerDialog'
import { AccountMenu } from './AccountMenu'
import { CommentLayer, type CommentLayerHandle } from './CommentLayer'
import { ChangePasswordDialog } from './ChangePasswordDialog'
import { ConfirmationDialog } from './ConfirmationDialog'
import { ProfileDialog } from './ProfileDialog'
import { ServerStoragePanel, type ServerStorageOverview } from './ServerStoragePanel'
import { api, ApiRequestError } from './api'
import type { SessionResponse, UserProfile } from './accountTypes'
import {
  consumePrivatePresentationReturnPath,
  normalizePrivatePresentationReturnPath,
  rememberPrivatePresentationReturnPath
} from './privatePresentationReturn'

interface SharedPresentationResponse {
  document: PresentationDocument
  assets: Record<string, string>
  access: {
    isPublic: boolean
    authenticated: boolean
    canComment: boolean
  }
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
  const [existingAccount, setExistingAccount] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (mode !== 'activate' || !token) return
    let active = true
    api<{ active: boolean; email: string; displayName: string }>(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then((invite) => {
        if (!active) return
        setEmail(invite.email)
        setInvitedName(invite.displayName)
        setExistingAccount(invite.active)
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : 'This password link is unavailable.'))
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
        <h1>{mode === 'setup'
          ? 'Create your owner password'
          : mode === 'activate'
            ? existingAccount ? 'Choose a new password' : `Welcome${invitedName ? `, ${invitedName}` : ''}`
            : 'Sign in to Cueport'}</h1>
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
          {busy ? 'Please wait…' : mode === 'setup' ? 'Create owner account' : mode === 'activate' ? existingAccount ? 'Save new password' : 'Activate account' : 'Sign in'}
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
  const mayEdit = canEditPresentations(profile.role)
  const mayManageAccounts = canManageAccounts(profile.role)
  const [presentations, setPresentations] = useState<PublishedPresentation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [serverStorage, setServerStorage] = useState<ServerStorageOverview | null>(null)
  const [storageLoading, setStorageLoading] = useState(profile.role === 'owner')
  const [storageError, setStorageError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<{
    presentation: PublishedPresentation
    type: 'delete' | 'take-offline'
  } | null>(null)
  const copyReset = useManagedTimeout()
  const copyRequestRef = useRef(0)

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

  const refreshStorage = useCallback(async (): Promise<void> => {
    if (profile.role !== 'owner') return
    setStorageLoading(true)
    try {
      setServerStorage(await api<ServerStorageOverview>('/api/server/storage'))
      setStorageError(null)
    } catch (cause) {
      setStorageError(cause instanceof Error ? cause.message : 'Server storage could not be measured.')
    } finally {
      setStorageLoading(false)
    }
  }, [profile.role])

  useEffect(() => {
    void refresh()
    void refreshStorage()
  }, [refresh, refreshStorage])

  const remove = async (presentation: PublishedPresentation): Promise<void> => {
    await api(`/api/presentations/${presentation.id}`, { method: 'DELETE', body: '{}' })
    await Promise.all([refresh(), refreshStorage()])
  }

  const rename = async (presentation: PublishedPresentation, name: string): Promise<void> => {
    await api(`/api/presentations/${presentation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    })
    await refresh()
  }

  const takeOffline = async (presentation: PublishedPresentation): Promise<void> => {
    await api(`/api/presentations/${presentation.id}/revoke`, { method: 'POST', body: '{}' })
    await refresh()
  }

  const copy = async (presentation: PublishedPresentation): Promise<void> => {
    if (!presentation.shareUrl) return
    const requestId = ++copyRequestRef.current
    copyReset.cancel()
    setCopiedId(null)
    setError(null)
    try {
      await copyTextToClipboard(presentation.shareUrl)
      if (requestId !== copyRequestRef.current) return
      setCopiedId(presentation.id)
      copyReset.schedule(() => {
        setCopiedId((current) => current === presentation.id ? null : current)
      }, 2200)
    } catch (cause) {
      if (requestId !== copyRequestRef.current) return
      setCopiedId(null)
      setError(cause instanceof Error ? cause.message : 'The private link could not be copied.')
    }
  }

  return (
    <main className="dashboard-screen">
      <header className="dashboard-header">
        <Brand />
        <AccountMenu onAccounts={mayManageAccounts ? () => setAccountsOpen(true) : undefined} onLogout={onLogout} onPassword={() => setPasswordOpen(true)} onProfile={() => setProfileOpen(true)} profile={profile} />
      </header>
      <section className="dashboard-content">
        {profile.role === 'owner' && (
          <ServerStoragePanel
            error={storageError}
            loading={storageLoading}
            onRefresh={() => void refreshStorage()}
            storage={serverStorage}
          />
        )}
        {error && <p className="web-error" role="alert">{error}</p>}
        {loading ? (
          <div className="dashboard-empty">Loading presentations…</div>
        ) : presentations.length === 0 ? (
          <div className="dashboard-empty">
            <Icon name={mayEdit ? 'upload' : 'layers'} size={24} />
            <strong>{mayEdit ? 'No presentation is available to edit yet.' : 'No presentation has been shared with you yet.'}</strong>
            <span>{mayEdit ? 'Publish one from the desktop app or ask for Editor access to an existing presentation.' : 'Shared presentations will appear here automatically.'}</span>
          </div>
        ) : (
          <div className="publication-grid">
            {presentations.map((presentation) => (
              <PublicationCard
                copied={copiedId === presentation.id}
                key={presentation.id}
                onAccessSaved={() => void refresh()}
                onCopy={(item) => void copy(item)}
                onDelete={(item) => setPendingAction({ presentation: item, type: 'delete' })}
                onRename={rename}
                onTakeOffline={(item) => setPendingAction({ presentation: item, type: 'take-offline' })}
                presentation={presentation}
              />
            ))}
          </div>
        )}
      </section>
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} onSaved={onProfileChange} profile={profile} />}
      {accountsOpen && mayManageAccounts && <AccountManagerDialog currentUserId={profile.id} onClose={() => setAccountsOpen(false)} />}
      {passwordOpen && <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />}
      {pendingAction && (
        <ConfirmationDialog
          confirmLabel={pendingAction.type === 'delete' ? 'Delete presentation' : 'Take link offline'}
          description={pendingAction.type === 'delete'
            ? `“${pendingAction.presentation.name}” and its uploaded web media will be permanently deleted.`
            : `Anyone using the private link for “${pendingAction.presentation.name}” will lose access until you publish it again.`}
          errorMessage={pendingAction.type === 'delete' ? 'The presentation could not be deleted.' : 'The private link could not be taken offline.'}
          eyebrow={pendingAction.type === 'delete' ? 'Delete presentation' : 'Private link'}
          icon={pendingAction.type === 'delete' ? 'remove' : 'eye-off'}
          onClose={() => setPendingAction(null)}
          onConfirm={() => pendingAction.type === 'delete' ? remove(pendingAction.presentation) : takeOffline(pendingAction.presentation)}
          title={pendingAction.type === 'delete' ? 'Delete this presentation?' : 'Take this link offline?'}
          tone={pendingAction.type === 'delete' ? 'danger' : 'primary'}
        />
      )}
    </main>
  )
}

function SharedViewer({ token, onAuthenticationRequired }: {
  token: string
  onAuthenticationRequired: () => void
}): React.JSX.Element {
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
        if (!active) return
        if (cause instanceof ApiRequestError && cause.status === 401) {
          onAuthenticationRequired()
          return
        }
        setError(cause instanceof Error ? cause.message : 'This presentation is unavailable.')
      })
    return () => { active = false }
  }, [onAuthenticationRequired, token])

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

  useAdjacentMediaPreload(assets.slides, activeIndex)

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
      if (event.key.toLowerCase() === 'c' && shared?.access.canComment) {
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
  }, [navigate, shared?.access.canComment, zoomBy])

  if (error) return <main className="share-message"><Brand /><h1>Presentation unavailable</h1><p>{error}</p></main>
  if (!shared || !assets.brand || !view) return <main className="share-message"><Brand /><p>Loading presentation…</p></main>
  const settings = shared.document.settings
  const slide = assets.slides[activeIndex] ?? assets.slides[0] ?? null

  return (
    <div className={`public-viewer-shell app-shell${isInterfaceVisible ? '' : ' web-viewer-interface-hidden'}`}>
      <ViewerControls
        canComment={shared.access.canComment}
        commentsEnabled={commentsEnabled}
        downloadUrl={`/api/share/${encodeURIComponent(token)}/download`}
        isVisible={isInterfaceVisible}
        mode={view.mode}
        activeSlideIndex={activeIndex}
        onCommentsToggle={() => setCommentsEnabled((enabled) => !enabled)}
        onModeChange={(mode) => setView((current) => current ? { ...current, mode } : current)}
        onSlideSelect={setActiveIndex}
        onViewportMarkerChange={(viewportMarker) => setView((current) => current ? { ...current, viewportMarker } : current)}
        onViewportToggle={() => setView((current) => current ? { ...current, viewportEnabled: !current.viewportEnabled } : current)}
        onZoomReset={() => setZoom(1)}
        viewportEnabled={view.viewportEnabled}
        viewportHeight={settings.viewport.height}
        viewportMarker={view.viewportMarker}
        slides={assets.slides}
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
          onCreateCommentAt={shared.access.canComment ? createCommentAt : undefined}
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
          artworkOverlay={slide && shared.access.canComment ? (
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
  const currentPrivatePresentationPath = normalizePrivatePresentationReturnPath(location.pathname)
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [shareLoginRequired, setShareLoginRequired] = useState(false)
  const query = new URLSearchParams(location.search)
  const setupToken = query.get('setup') || undefined
  const activationToken = query.get('activate') || undefined

  useEffect(() => {
    api<SessionResponse>('/api/session').then(setSession).catch(() => setSession({ authenticated: false }))
  }, [shareMatch?.[1]])

  const requireShareAuthentication = useCallback((): void => {
    if (currentPrivatePresentationPath) {
      rememberPrivatePresentationReturnPath(sessionStorage, currentPrivatePresentationPath)
    }
    setShareLoginRequired(true)
  }, [currentPrivatePresentationPath])

  const finishAuthentication = (user: UserProfile): void => {
    const rememberedPath = consumePrivatePresentationReturnPath(sessionStorage)
    const returnPath = currentPrivatePresentationPath ?? rememberedPath

    if (returnPath) {
      history.replaceState(null, '', returnPath)
    } else if (setupToken || activationToken) {
      history.replaceState(null, '', '/')
    }

    // Re-render after replaceState so the restored private route opens directly.
    setSession({ authenticated: true, user })
  }

  if (!session) return <main className="share-message"><Brand /><p>Loading Cueport…</p></main>
  if (activationToken) {
    return <AccountForm mode="activate" onSuccess={finishAuthentication} token={activationToken} />
  }
  if (shareMatch && (!shareLoginRequired || session.authenticated)) {
    return (
      <SharedViewer
        onAuthenticationRequired={requireShareAuthentication}
        token={decodeURIComponent(shareMatch[1])}
      />
    )
  }
  if (!session.authenticated) {
    return <AccountForm mode={setupToken ? 'setup' : 'login'} onSuccess={finishAuthentication} token={setupToken} />
  }
  if (!session.user) return <main className="share-message"><Brand /><p>Your account could not be loaded.</p></main>

  const logout = (): void => {
    void api('/api/auth/logout', { method: 'POST', body: '{}' }).finally(() => setSession({ authenticated: false }))
  }
  const updateProfile = (user: UserProfile): void => setSession({ authenticated: true, user })

  return <Dashboard onLogout={logout} onProfileChange={updateProfile} profile={session.user} />
}
