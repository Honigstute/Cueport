import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { PresentationDocument } from '../../../../src/shared/presentation'
import { Stage } from '../../../../src/renderer/src/components/Stage'
import { Filmstrip } from '../../../../src/renderer/src/components/Filmstrip'
import { Inspector } from '../../../../src/renderer/src/components/Inspector'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { useManagedTimeout } from '../../../../src/renderer/src/hooks/useManagedTimeout'
import { useAdjacentMediaPreload } from '../../../../src/renderer/src/hooks/useAdjacentMediaPreload'
import { copyTextToClipboard } from '../../../../src/renderer/src/lib/clipboard'
import { importWebLogo, importWebMedia } from './webEditorMedia'
import { nextZoomStop } from '../../../../src/renderer/src/lib/zoom'
import { createInitialState, presentationReducer, type PresentationAction } from '../../../../src/renderer/src/state/presentationReducer'
import type { CanvasFrame, ViewportCategory, ViewportSize } from '../../../../src/renderer/src/types'
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
  documentFromEditorState,
  saveEditorPresentation,
  type EditorSavePhase,
  type PendingEditorAsset,
  type PublishedEditorAsset
} from './webEditorPublication'
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
    canEdit: boolean
  }
  editor: {
    presentationId: string
    revisionId: string
    assets: PublishedEditorAsset[]
  } | null
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
  const [state, dispatch] = useReducer(presentationReducer, createInitialState())
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(0)
  const [isInterfaceVisible, setIsInterfaceVisible] = useState(true)
  const [commentsEnabled, setCommentsEnabled] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<'presentation' | 'edit'>('presentation')
  const [leftPanelTab, setLeftPanelTab] = useState<'sequence' | 'references'>('sequence')
  const [isDirty, setIsDirty] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isDropActive, setIsDropActive] = useState(false)
  const [savePhase, setSavePhase] = useState<EditorSavePhase | 'idle' | 'saved'>('idle')
  const [editorMessage, setEditorMessage] = useState<string | null>(null)
  const [leavePromptOpen, setLeavePromptOpen] = useState(false)
  const commentLayerRef = useRef<CommentLayerHandle>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const pendingAssetsRef = useRef(new Map<string, PendingEditorAsset>())
  const currentAssetsRef = useRef(new Map<string, PublishedEditorAsset>())
  const posterKeysRef = useRef(new Map<string, string>())
  const localUrlsRef = useRef(new Set<string>())
  const lastNonPhoneFrameRef = useRef<Exclude<CanvasFrame, 'phone'>>('none')

  const releaseLocalUrls = useCallback((): void => {
    for (const url of localUrlsRef.current) URL.revokeObjectURL(url)
    localUrlsRef.current.clear()
  }, [])

  const hydrate = useCallback((response: SharedPresentationResponse): void => {
    releaseLocalUrls()
    pendingAssetsRef.current.clear()
    currentAssetsRef.current = new Map(response.editor?.assets.map((asset) => [asset.key, asset]) ?? [])
    posterKeysRef.current = new Map([
      ...response.document.slides,
      ...response.document.references
    ].flatMap((media) => media.posterKey ? [[media.id, media.posterKey] as const] : []))

    const media = (item: PresentationDocument['slides'][number]) => {
      const url = response.assets[item.assetKey] || ''
      return {
        id: item.id,
        name: item.name,
        width: item.width,
        height: item.height,
        mimeType: item.mimeType,
        origin: 'local' as const,
        // The portable asset key is also the stable web-editor source identity.
        sourceKey: item.assetKey,
        url,
        thumbnailUrl: item.posterKey
          ? response.assets[item.posterKey] || ''
          : item.mimeType.startsWith('image/') ? url : ''
      }
    }
    dispatch({
      type: 'RESTORE_PRESENTATION',
      slides: response.document.slides.map(media),
      references: response.document.references.map(media),
      activeId: response.document.activeSlideId,
      settings: response.document.settings,
      logo: response.document.brand ? {
        name: response.document.brand.name,
        sourceKey: response.document.brand.assetKey,
        url: response.assets[response.document.brand.assetKey] || ''
      } : null
    })
    lastNonPhoneFrameRef.current = response.document.settings.canvasFrame === 'phone'
      ? 'none'
      : response.document.settings.canvasFrame
    setShared(response)
    setZoom(1)
    setFitWidth(0)
    setIsDirty(false)
  }, [releaseLocalUrls])

  useEffect(() => {
    let active = true
    setShared(null)
    setError(null)
    setZoom(1)
    setIsInterfaceVisible(true)
    setCommentsEnabled(false)
    setWorkspaceMode('presentation')
    setSavePhase('idle')
    setEditorMessage(null)
    api<SharedPresentationResponse>(`/api/share/${encodeURIComponent(token)}`)
      .then((response) => {
        if (!active) return
        hydrate(response)
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
  }, [hydrate, onAuthenticationRequired, token])

  useEffect(() => () => releaseLocalUrls(), [releaseLocalUrls])

  useEffect(() => {
    if (!isDirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => event.preventDefault()
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [isDirty])

  const activeIndex = Math.max(0, state.slides.findIndex((slide) => slide.id === state.activeId))
  const slide = state.slides[activeIndex] ?? state.slides[0] ?? null
  useAdjacentMediaPreload(state.slides, activeIndex)

  const update = useCallback((action: PresentationAction, persisted = false): void => {
    dispatch(action)
    if (persisted && workspaceMode === 'edit') {
      setIsDirty(true)
      setSavePhase('idle')
      setEditorMessage(null)
    }
  }, [workspaceMode])

  const navigate = useCallback((direction: -1 | 1): void => {
    const next = Math.max(0, Math.min(state.slides.length - 1, activeIndex + direction))
    const nextSlide = state.slides[next]
    if (nextSlide) dispatch({ type: 'SELECT_SLIDE', id: nextSlide.id })
  }, [activeIndex, state.slides])

  const zoomBy = useCallback((direction: -1 | 1): void => {
    update({ type: 'SET_MODE', mode: 'canvas' }, true)
    setZoom((current) => nextZoomStop(current, direction))
  }, [update])

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
        update({ type: 'SET_MODE', mode: 'canvas' }, true)
      }
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault()
        update({ type: 'SET_MODE', mode: 'fit-width' }, true)
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        if (state.mode === 'canvas') update({ type: 'SET_VIEWPORT_ENABLED', value: !state.viewportEnabled }, true)
      }
      if (event.key === '0') {
        event.preventDefault()
        update({ type: 'SET_MODE', mode: 'canvas' }, true)
        setZoom(1)
      }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1) }
      if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, shared?.access.canComment, state.mode, state.viewportEnabled, update, zoomBy])

  const addFiles = useCallback(async (files: File[], collection: 'slides' | 'references'): Promise<void> => {
    if (files.length === 0) return
    setIsImporting(true)
    setEditorMessage(null)
    const batchKeys: string[] = []
    const batchUrls: string[] = []
    const batchIds: string[] = []
    try {
      const imported = []
      for (const file of files) {
        const item = await importWebMedia(file, collection)
        imported.push(item.asset)
        batchIds.push(item.asset.id)
        posterKeysRef.current.set(item.asset.id, item.posterKey ?? '')
        for (const [key, pending] of item.pending) {
          pendingAssetsRef.current.set(key, pending)
          batchKeys.push(key)
        }
        if (item.asset.url.startsWith('blob:')) {
          localUrlsRef.current.add(item.asset.url)
          batchUrls.push(item.asset.url)
        }
      }
      update({ type: collection === 'slides' ? 'ADD_SLIDES' : 'ADD_REFERENCES', [collection]: imported } as PresentationAction, true)
    } catch (cause) {
      for (const key of batchKeys) pendingAssetsRef.current.delete(key)
      for (const id of batchIds) posterKeysRef.current.delete(id)
      for (const url of batchUrls) {
        URL.revokeObjectURL(url)
        localUrlsRef.current.delete(url)
      }
      setEditorMessage(cause instanceof Error ? cause.message : 'The selected media could not be added.')
    } finally {
      setIsImporting(false)
    }
  }, [update])

  useEffect(() => {
    if (workspaceMode !== 'edit' || !shared?.access.canEdit) {
      setIsDropActive(false)
      return
    }
    const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const showDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setIsDropActive(true)
    }
    const hideDrop = (event: DragEvent): void => {
      if (event.relatedTarget === null) setIsDropActive(false)
    }
    const acceptDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setIsDropActive(false)
      void addFiles(Array.from(event.dataTransfer?.files ?? []), leftPanelTab === 'sequence' ? 'slides' : 'references')
    }
    window.addEventListener('dragenter', showDrop)
    window.addEventListener('dragover', showDrop)
    window.addEventListener('dragleave', hideDrop)
    window.addEventListener('drop', acceptDrop)
    return () => {
      window.removeEventListener('dragenter', showDrop)
      window.removeEventListener('dragover', showDrop)
      window.removeEventListener('dragleave', hideDrop)
      window.removeEventListener('drop', acceptDrop)
    }
  }, [addFiles, leftPanelTab, shared?.access.canEdit, workspaceMode])

  const removeMedia = useCallback((id: string, collection: 'slides' | 'references'): void => {
    if (collection === 'slides' && state.slides.length <= 1) {
      setEditorMessage('A presentation needs at least one Sequence item.')
      return
    }
    const media = (collection === 'slides' ? state.slides : state.references).find((item) => item.id === id)
    if (media?.url.startsWith('blob:')) {
      URL.revokeObjectURL(media.url)
      localUrlsRef.current.delete(media.url)
    }
    if (media?.sourceKey) pendingAssetsRef.current.delete(media.sourceKey)
    const posterKey = posterKeysRef.current.get(id)
    if (posterKey) pendingAssetsRef.current.delete(posterKey)
    posterKeysRef.current.delete(id)
    update({ type: collection === 'slides' ? 'REMOVE_SLIDE' : 'REMOVE_REFERENCE', id }, true)
  }, [state.references, state.slides, update])

  const addLogo = useCallback(async (file: File): Promise<void> => {
    setIsImporting(true)
    setEditorMessage(null)
    try {
      const logo = await importWebLogo(file)
      if (state.brand.logoUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(state.brand.logoUrl)
        localUrlsRef.current.delete(state.brand.logoUrl)
      }
      if (state.brand.logoSourceKey) pendingAssetsRef.current.delete(state.brand.logoSourceKey)
      pendingAssetsRef.current.set(logo.assetKey, logo.pending)
      if (logo.url.startsWith('blob:')) localUrlsRef.current.add(logo.url)
      update({ type: 'SET_LOGO', name: logo.name, sourceKey: logo.assetKey, url: logo.url }, true)
    } catch (cause) {
      setEditorMessage(cause instanceof Error ? cause.message : 'The client mark could not be added.')
    } finally {
      setIsImporting(false)
    }
  }, [state.brand.logoSourceKey, state.brand.logoUrl, update])

  const removeLogo = useCallback((): void => {
    if (state.brand.logoUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(state.brand.logoUrl)
      localUrlsRef.current.delete(state.brand.logoUrl)
    }
    if (state.brand.logoSourceKey) pendingAssetsRef.current.delete(state.brand.logoSourceKey)
    update({ type: 'REMOVE_LOGO' }, true)
  }, [state.brand.logoSourceKey, state.brand.logoUrl, update])

  const save = useCallback(async (): Promise<void> => {
    if (!shared?.editor || !isDirty || savePhase === 'preparing' || savePhase === 'uploading' || savePhase === 'finalizing') return
    setEditorMessage(null)
    try {
      const document = documentFromEditorState(state, shared.document, new Map(
        [...posterKeysRef.current].filter((entry): entry is [string, string] => Boolean(entry[1]))
      ))
      await saveEditorPresentation({
        baseRevisionId: shared.editor.revisionId,
        currentAssets: currentAssetsRef.current,
        document,
        onPhase: setSavePhase,
        pendingAssets: pendingAssetsRef.current
      })
      const refreshed = await api<SharedPresentationResponse>(`/api/share/${encodeURIComponent(token)}`)
      hydrate(refreshed)
      setSavePhase('saved')
      window.setTimeout(() => setSavePhase((phase) => phase === 'saved' ? 'idle' : phase), 1800)
    } catch (cause) {
      setSavePhase('idle')
      setEditorMessage(cause instanceof Error ? cause.message : 'The presentation could not be saved.')
    }
  }, [hydrate, isDirty, savePhase, shared, state, token])

  if (error) return <main className="share-message"><Brand /><h1>Presentation unavailable</h1><p>{error}</p></main>
  if (!shared) return <main className="share-message"><Brand /><p>Loading presentation…</p></main>
  const canEdit = shared.access.canEdit && Boolean(shared.editor)
  const editorIsVisible = canEdit && workspaceMode === 'edit' && isInterfaceVisible

  return (
    <div className={`public-viewer-shell app-shell${isInterfaceVisible ? '' : ' web-viewer-interface-hidden'}${editorIsVisible ? ' chrome-all web-editor-active' : ''}`}>
      <input
        accept=".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"
        hidden
        multiple
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []), 'slides')
          event.target.value = ''
        }}
        ref={mediaInputRef}
        type="file"
      />
      <input
        accept=".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"
        hidden
        multiple
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []), 'references')
          event.target.value = ''
        }}
        ref={referenceInputRef}
        type="file"
      />
      <ViewerControls
        canEdit={canEdit}
        canComment={shared.access.canComment}
        commentsEnabled={commentsEnabled}
        downloadUrl={`/api/share/${encodeURIComponent(token)}/download`}
        editorDirty={isDirty}
        editorSavePhase={savePhase}
        isVisible={isInterfaceVisible}
        mode={state.mode}
        activeSlideIndex={activeIndex}
        onCommentsToggle={() => setCommentsEnabled((enabled) => !enabled)}
        onEditorSave={() => void save()}
        onHome={() => {
          if (isDirty) setLeavePromptOpen(true)
          else location.assign('/')
        }}
        onModeChange={(mode) => update({ type: 'SET_MODE', mode }, true)}
        onSlideSelect={(index) => {
          const selected = state.slides[index]
          if (selected) dispatch({ type: 'SELECT_SLIDE', id: selected.id })
        }}
        onViewportMarkerChange={(marker) => update({ type: 'SET_VIEWPORT_MARKER', marker }, true)}
        onViewportToggle={() => update({ type: 'SET_VIEWPORT_ENABLED', value: !state.viewportEnabled }, true)}
        onWorkspaceModeChange={setWorkspaceMode}
        onZoomReset={() => setZoom(1)}
        viewportEnabled={state.viewportEnabled}
        viewportHeight={state.viewport.height}
        viewportMarker={state.viewportMarker}
        slides={state.slides}
        workspaceMode={workspaceMode}
        zoom={zoom}
      />
      <div className="workspace">
        <div className="chrome-drawer chrome-drawer-left web-editor-drawer" aria-hidden={!editorIsVisible} inert={!editorIsVisible ? true : undefined}>
          <Filmstrip
            activeId={state.activeId}
            activeTab={leftPanelTab}
            onChooseMedia={() => mediaInputRef.current?.click()}
            onChooseReferences={() => referenceInputRef.current?.click()}
            onMove={(fromIndex, toIndex) => update({ type: 'MOVE_SLIDE', fromIndex, toIndex }, true)}
            onMoveReference={(fromIndex, toIndex) => update({ type: 'MOVE_REFERENCE', fromIndex, toIndex }, true)}
            onRemove={(id) => removeMedia(id, 'slides')}
            onRemoveReference={(id) => removeMedia(id, 'references')}
            onRename={async (id, name) => update({ type: 'RENAME_SLIDE', id, name }, true)}
            onSelect={(id) => dispatch({ type: 'SELECT_SLIDE', id })}
            onTabChange={setLeftPanelTab}
            references={state.references}
            sequenceTitles={state.sequenceTitles}
            slides={state.slides}
          />
        </div>
        <Stage
          background={state.background}
          brand={state.brand}
          canNavigateNext={activeIndex < state.slides.length - 1}
          canNavigatePrevious={activeIndex > 0}
          canvasFrame={state.canvasFrame}
          canvasImageGlow={state.canvasImageGlow}
          canvasRoundedCorners={state.canvasRoundedCorners}
          canvasStartAtTop={state.canvasStartAtTop}
          chromeMode="hidden"
          isImporting={isImporting}
          mode={state.mode}
          onChooseMedia={() => canEdit && workspaceMode === 'edit' && mediaInputRef.current?.click()}
          onFitWidthChange={(_slideId, width) => setFitWidth(width)}
          onNavigate={navigate}
          onCreateCommentAt={shared.access.canComment ? createCommentAt : undefined}
          onZoomChange={setZoom}
          phoneBrowserBars={state.phoneBrowserBars}
          programBarColor={state.programBarColor}
          referenceImageShadow={state.referenceImageShadow}
          references={state.references}
          slide={slide}
          viewport={state.viewport}
          viewportEnabled={state.viewportEnabled}
          viewportMarker={state.viewportMarker}
          zoom={state.mode === 'fit-width' && fitWidth ? 1 : zoom}
          artworkOverlay={slide && shared.access.canComment ? (
            <CommentLayer
              enabled={commentsEnabled && isInterfaceVisible}
              ref={commentLayerRef}
              shareToken={token}
              slideId={slide.id}
            />
          ) : null}
        />
        <div className="chrome-drawer chrome-drawer-right web-editor-drawer" aria-hidden={!editorIsVisible} inert={!editorIsVisible ? true : undefined}>
          <Inspector
            background={state.background}
            brand={state.brand}
            canvasFrame={state.canvasFrame}
            canvasImageGlow={state.canvasImageGlow}
            canvasRoundedCorners={state.canvasRoundedCorners}
            canvasStartAtTop={state.canvasStartAtTop}
            onBackgroundChange={(background) => update({ type: 'SET_BACKGROUND', background }, true)}
            onCanvasFrameChange={(frame) => {
              if (frame !== 'phone') lastNonPhoneFrameRef.current = frame
              update({ type: 'SET_CANVAS_FRAME', frame }, true)
            }}
            onCanvasImageGlowChange={(value) => update({ type: 'SET_CANVAS_IMAGE_GLOW', value }, true)}
            onCanvasRoundedCornersChange={(value) => update({ type: 'SET_CANVAS_ROUNDED_CORNERS', value }, true)}
            onCanvasStartAtTopChange={(value) => update({ type: 'SET_CANVAS_START_AT_TOP', value }, true)}
            onLogoFile={(file) => void addLogo(file)}
            onPatchBrand={(patch) => update({ type: 'PATCH_BRAND', patch }, true)}
            onPhoneBrowserBarsChange={(patch) => update({ type: 'PATCH_PHONE_BROWSER_BARS', patch }, true)}
            onProgramBarColorChange={(color) => update({ type: 'SET_PROGRAM_BAR_COLOR', color }, true)}
            onReferenceImageShadowChange={(value) => update({ type: 'SET_REFERENCE_IMAGE_SHADOW', value }, true)}
            onRemoveLogo={removeLogo}
            onViewportCategoryChange={(category: ViewportCategory, viewport: ViewportSize) => {
              update({ type: 'SET_VIEWPORT', viewport }, true)
              update({
                type: 'SET_CANVAS_FRAME',
                frame: category === 'Mobile' ? 'phone' : lastNonPhoneFrameRef.current
              }, true)
            }}
            onViewportChange={(viewport) => update({ type: 'SET_VIEWPORT', viewport }, true)}
            phoneBrowserBars={state.phoneBrowserBars}
            programBarColor={state.programBarColor}
            referenceImageShadow={state.referenceImageShadow}
            viewport={state.viewport}
            viewportEnabled={state.viewportEnabled}
          />
        </div>
      </div>
      {editorMessage && (
        <div className="web-editor-message" role="alert">
          <Icon name="close" size={14} />
          <span>{editorMessage}</span>
          <button aria-label="Dismiss" onClick={() => setEditorMessage(null)} type="button"><Icon name="close" size={13} /></button>
        </div>
      )}
      {isDropActive && (
        <div className="drop-overlay web-editor-drop-overlay">
          <div>
            <Icon name="upload" size={24} />
            <strong>Release to add to {leftPanelTab === 'sequence' ? 'the Sequence' : 'References'}</strong>
            <span>JPEG, PNG, WebP, or MP4</span>
          </div>
        </div>
      )}
      {state.slides.length > 1 && workspaceMode === 'presentation' && (
        <div className="viewer-counter" aria-live="polite">{activeIndex + 1} / {state.slides.length}</div>
      )}
      {leavePromptOpen && (
        <ConfirmationDialog
          confirmLabel="Leave without saving"
          description="Your web edits have not been saved to this presentation."
          errorMessage="Cueport could not return to the presentation list."
          eyebrow="Unsaved changes"
          icon="home"
          onClose={() => setLeavePromptOpen(false)}
          onConfirm={() => location.assign('/')}
          title="Leave this presentation?"
          tone="danger"
        />
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
