import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { AssetImportError, createLogoAsset, createPresentationPreviewDataUrl, createSlideAsset, createVideoPosterDataUrl, isSupportedVideoName, revokeLocalAsset, revokeSlideAsset } from './lib/assets'
import { normalizeHex } from './lib/colors'
import { Filmstrip } from './components/Filmstrip'
import { HelpDialog } from './components/HelpDialog'
import { HomeScreen } from './components/HomeScreen'
import { Inspector } from './components/Inspector'
import { PresentationNameDialog } from './components/PresentationNameDialog'
import { Stage } from './components/Stage'
import { Toast } from './components/Toast'
import { TopBar } from './components/TopBar'
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
import { toggleCompleteInterface, toggleSidePanels } from './lib/chrome'
import { moveItem } from './lib/deck'
import { calculateDisplayResolution } from './lib/displayResolution'
import { createProjectChangeSnapshot, snapshotPresentationState } from './lib/projectSnapshot'
import {
  DEFAULT_CANVAS_BACKGROUND,
  createInitialState,
  parseStoredSettings,
  presentationReducer,
  toStoredSettings
} from './state/presentationReducer'
import type { CanvasFrame, ChromeMode, DisplayMode, LogoPosition, ReferenceAsset, SlideAsset, ToastMessage, ViewportCategory, ViewportSize } from './types'
import type { SlideNavigationDirection } from './hooks/useClickDragScroll'
import type { SavedPresentationSummary } from '../../shared/projects'

const SETTINGS_KEY = 'cueport:presentation-settings:v3'
const VERSION_TWO_SETTINGS_KEY = 'cueport:presentation-settings:v2'
const VERSION_ONE_SETTINGS_KEY = 'cueport:presentation-settings:v1'

interface SlideViewTransition {
  finished: Promise<void>
  skipTransition: () => void
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => SlideViewTransition
}

type PresentationNameRequest =
  | { mode: 'save'; initialName: string }
  | { mode: 'rename'; presentation: SavedPresentationSummary }

function loadStoredSettings(): ReturnType<typeof parseStoredSettings> {
  const current = localStorage.getItem(SETTINGS_KEY)
  if (current) return parseStoredSettings(current)

  const versionTwo = localStorage.getItem(VERSION_TWO_SETTINGS_KEY)
  if (versionTwo) return parseStoredSettings(versionTwo)

  const legacy = parseStoredSettings(localStorage.getItem(VERSION_ONE_SETTINGS_KEY))
  // Version 1 used the light gray as its implicit default. Migrate only that
  // legacy value; colors explicitly chosen in the new theme remain untouched.
  return legacy.background.toUpperCase() === '#D9DCE1'
    ? { ...legacy, background: DEFAULT_CANVAS_BACKGROUND }
    : legacy
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export default function App(): React.JSX.Element {
  const [state, dispatch] = useReducer(
    presentationReducer,
    undefined,
    () => createInitialState(loadStoredSettings())
  )
  const [isImporting, setIsImporting] = useState(false)
  const [isDropActive, setIsDropActive] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [isHome, setIsHome] = useState(true)
  const [savedPresentations, setSavedPresentations] = useState<SavedPresentationSummary[]>([])
  const [isLoadingPresentations, setIsLoadingPresentations] = useState(true)
  const [openingPresentationId, setOpeningPresentationId] = useState<string | null>(null)
  const [savedPresentation, setSavedPresentation] = useState<Pick<SavedPresentationSummary, 'id' | 'name'> | null>(null)
  const [presentationNameRequest, setPresentationNameRequest] = useState<PresentationNameRequest | null>(null)
  const [savedProjectSnapshot, setSavedProjectSnapshot] = useState<string | null>(null)
  const [isUnsavedPromptOpen, setIsUnsavedPromptOpen] = useState(false)
  const [isSavingOnExit, setIsSavingOnExit] = useState(false)
  const [returnHomeAfterSave, setReturnHomeAfterSave] = useState(false)
  const [fitWidthMeasurement, setFitWidthMeasurement] = useState<{ slideId: string; width: number } | null>(null)
  const [leftPanelTab, setLeftPanelTab] = useState<'sequence' | 'references'>('sequence')

  const mediaInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const importInFlightRef = useRef(false)
  const slidesRef = useRef<SlideAsset[]>([])
  const referencesRef = useRef<ReferenceAsset[]>([])
  const logoUrlRef = useRef<string | null>(null)
  const logoRequestRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)
  const canvasTransitionRef = useRef<SlideViewTransition | null>(null)
  const saveInFlightRef = useRef(false)
  const hShortcutTimerRef = useRef<number | null>(null)
  const chromeModeRef = useRef<ChromeMode>(state.chromeMode)
  const presentationOrderWriteRef = useRef<Promise<void>>(Promise.resolve())
  const lastNonPhoneFrameRef = useRef<Exclude<CanvasFrame, 'phone'>>(
    state.canvasFrame === 'phone' ? 'none' : state.canvasFrame
  )

  const activeIndex = state.slides.findIndex((slide) => slide.id === state.activeId)
  const activeSlide = activeIndex >= 0 ? state.slides[activeIndex] : null
  const displayResolution = activeSlide
    ? calculateDisplayResolution({
        sourceWidth: activeSlide.width,
        sourceHeight: activeSlide.height,
        mode: state.mode,
        zoom,
        viewportEnabled: state.viewportEnabled,
        viewport: state.viewport,
        fitWidth: fitWidthMeasurement?.slideId === activeSlide.id ? fitWidthMeasurement.width : null
      })
    : null
  const currentProjectSnapshot = useMemo(() => snapshotPresentationState(state), [state])
  const isPresentationDirty = state.slides.length > 0 && currentProjectSnapshot !== savedProjectSnapshot

  useEffect(() => {
    slidesRef.current = state.slides
    referencesRef.current = state.references
    logoUrlRef.current = state.brand.logoUrl
  }, [state.slides, state.references, state.brand.logoUrl])

  useEffect(() => {
    chromeModeRef.current = state.chromeMode
  }, [state.chromeMode])

  const refreshSavedPresentations = useCallback(async (): Promise<void> => {
    if (!window.cueport) {
      setSavedPresentations([])
      setIsLoadingPresentations(false)
      return
    }
    try {
      setSavedPresentations(await window.cueport.listPresentations())
    } catch {
      setSavedPresentations([])
    } finally {
      setIsLoadingPresentations(false)
    }
  }, [])

  useEffect(() => {
    void refreshSavedPresentations()
  }, [refreshSavedPresentations])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toStoredSettings(state)))
  }, [state.mode, state.viewportEnabled, state.canvasStartAtTop, state.canvasRoundedCorners, state.canvasImageGlow, state.referenceImageShadow, state.canvasFrame, state.programBarColor, state.phoneBrowserBars.enabled, state.phoneBrowserBars.color, state.background, state.viewport, state.viewportMarker, state.sequenceTitles.hideExtension, state.sequenceTitles.preferEnding, state.brand.position, state.brand.width, state.brand.opacity, state.brand.margin, state.brand.showOnCanvas])

  useEffect(() => () => {
    slidesRef.current.forEach(revokeSlideAsset)
    referencesRef.current.forEach(revokeSlideAsset)
    revokeLocalAsset(logoUrlRef.current)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    if (hShortcutTimerRef.current) window.clearTimeout(hShortcutTimerRef.current)
    canvasTransitionRef.current?.skipTransition()
    delete document.documentElement.dataset.canvasTransition
    delete document.documentElement.dataset.slideDirection
  }, [])

  useEffect(() => {
    document.title = isHome
      ? 'Cueport'
      : savedPresentation
        ? `${savedPresentation.name} — Cueport`
        : activeSlide
          ? `${activeSlide.name} — Cueport`
          : 'Cueport'
  }, [activeSlide, isHome, savedPresentation])

  const showToast = useCallback((tone: ToastMessage['tone'], text: string): void => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    setToast({ id: Date.now(), tone, text })
    toastTimerRef.current = window.setTimeout(() => setToast(null), tone === 'error' ? 5200 : 3200)
  }, [])

  const importMedia = useCallback(async (
    fileList: FileList | File[],
    target: 'sequence' | 'references' = 'sequence',
    startNewPresentation = false
  ): Promise<void> => {
    const files = Array.from(fileList)
    if (files.length === 0) return
    if (importInFlightRef.current) {
      showToast('info', 'Finish the current import before adding more files.')
      return
    }

    importInFlightRef.current = true
    setIsImporting(true)
    const imported: SlideAsset[] = []
    const failures: unknown[] = []

    // Decode one large design at a time. Screenshots can expand to hundreds of
    // megabytes, while videos briefly need a decoder to capture their poster.
    for (const file of files) {
      try {
        if (target === 'references' && isSupportedVideoName(file.name)) {
          throw new AssetImportError('MP4 videos can be added to the sequence, not the References tray.')
        }
        imported.push(await createSlideAsset(file))
      } catch (error) {
        failures.push(error)
      }
    }
    importInFlightRef.current = false
    setIsImporting(false)

    if (imported.length > 0) {
      if (target === 'references') {
        dispatch({ type: 'ADD_REFERENCES', references: imported })
      } else if (startNewPresentation) {
        // Returning home keeps the current editor intact until replacement
        // files have decoded successfully. Only then release the old assets.
        slidesRef.current.forEach(revokeSlideAsset)
        referencesRef.current.forEach(revokeSlideAsset)
        revokeLocalAsset(logoUrlRef.current)
        logoRequestRef.current += 1
        dispatch({ type: 'START_PRESENTATION', slides: imported })
        setSavedPresentation(null)
        setSavedProjectSnapshot(null)
        setLeftPanelTab('sequence')
        setZoom(1)
      } else {
        dispatch({ type: 'ADD_SLIDES', slides: imported })
      }
      setIsHome(false)
      showToast(
        'success',
        `${imported.length} file${imported.length === 1 ? '' : 's'} added to ${target === 'references' ? 'References' : 'the sequence'}.`
      )
    }
    if (failures.length > 0) {
      const firstMessage = failures[0] instanceof Error ? failures[0].message : 'One or more files could not be read.'
      showToast('error', failures.length === 1 ? firstMessage : `${failures.length} files were skipped. ${firstMessage}`)
    }
  }, [showToast])

  const removeSlide = useCallback((id: string): void => {
    const slide = slidesRef.current.find((candidate) => candidate.id === id)
    if (slide) revokeSlideAsset(slide)
    dispatch({ type: 'REMOVE_SLIDE', id })
  }, [])

  const removeReference = useCallback((id: string): void => {
    const reference = referencesRef.current.find((candidate) => candidate.id === id)
    if (reference) revokeSlideAsset(reference)
    dispatch({ type: 'REMOVE_REFERENCE', id })
  }, [])

  const renameSlide = useCallback(async (id: string, requestedName: string): Promise<void> => {
    const slide = slidesRef.current.find((candidate) => candidate.id === id)
    if (!slide || slide.name === requestedName) return

    try {
      const result = slide.sourceKey && window.cueport
        ? await window.cueport.renameImportedFile(slide.sourceKey, requestedName)
        : { name: requestedName }
      dispatch({ type: 'RENAME_SLIDE', id, name: result.name })
      showToast('success', slide.sourceKey ? 'Sequence item and source file renamed.' : 'Sequence title renamed.')
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': /, '') : 'The file could not be renamed.'
      showToast('error', message)
      throw error
    }
  }, [showToast])

  const runCanvasTransition = useCallback((
    kind: 'mode' | 'slide',
    update: () => void,
    afterUpdate?: () => void
  ): void => {
    const transitionDocument = document as ViewTransitionDocument
    const root = document.documentElement
    const clearTransitionState = (): void => {
      delete root.dataset.canvasTransition
      if (kind === 'slide') delete root.dataset.slideDirection
    }

    if (
      !transitionDocument.startViewTransition ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      update()
      afterUpdate?.()
      clearTransitionState()
      return
    }

    canvasTransitionRef.current?.skipTransition()
    canvasTransitionRef.current = null
    root.dataset.canvasTransition = kind

    let transition: SlideViewTransition
    try {
      transition = transitionDocument.startViewTransition(() => {
        flushSync(update)
        afterUpdate?.()
      })
    } catch {
      clearTransitionState()
      update()
      afterUpdate?.()
      return
    }

    canvasTransitionRef.current = transition
    const finish = (): void => {
      if (canvasTransitionRef.current !== transition) return
      canvasTransitionRef.current = null
      clearTransitionState()
    }
    void transition.finished.then(finish, finish)
  }, [])

  const navigateToSlide = useCallback((id: string, direction: SlideNavigationDirection): void => {
    if (id === state.activeId || !state.slides.some((slide) => slide.id === id)) return

    const selectSlide = (): void => dispatch({ type: 'SELECT_SLIDE', id })
    document.documentElement.dataset.slideDirection = direction > 0 ? 'next' : 'previous'
    runCanvasTransition(
      'slide',
      selectSlide,
      () => document.querySelector<HTMLElement>('[data-active-scroll="true"]')?.scrollTo({ top: 0, left: 0 })
    )
  }, [runCanvasTransition, state.activeId, state.slides])

  const setActiveByOffset = useCallback((offset: number): void => {
    if (activeIndex < 0) return
    const next = state.slides[activeIndex + offset]
    if (next) navigateToSlide(next.id, offset < 0 ? -1 : 1)
  }, [activeIndex, navigateToSlide, state.slides])

  const selectSlide = useCallback((id: string): void => {
    const nextIndex = state.slides.findIndex((slide) => slide.id === id)
    if (nextIndex < 0 || nextIndex === activeIndex) return
    navigateToSlide(id, nextIndex < activeIndex ? -1 : 1)
  }, [activeIndex, navigateToSlide, state.slides])

  const setBackground = useCallback((value: string): void => {
    const normalized = normalizeHex(value)
    if (normalized) dispatch({ type: 'SET_BACKGROUND', background: normalized })
  }, [])

  const setProgramBarColor = useCallback((value: string): void => {
    const normalized = normalizeHex(value)
    if (normalized) dispatch({ type: 'SET_PROGRAM_BAR_COLOR', color: normalized })
  }, [])

  const addLogo = useCallback(async (file: File): Promise<void> => {
    const requestId = ++logoRequestRef.current
    try {
      const logo = await createLogoAsset(file)
      if (requestId !== logoRequestRef.current) {
        revokeLocalAsset(logo.url)
        return
      }
      revokeLocalAsset(logoUrlRef.current)
      dispatch({ type: 'SET_LOGO', url: logo.url, name: logo.name, sourceKey: logo.sourceKey })
      showToast('success', 'Client mark added to the presentation canvas.')
    } catch (error) {
      if (requestId !== logoRequestRef.current) return
      showToast('error', error instanceof Error ? error.message : 'The logo could not be read.')
    }
  }, [showToast])

  const removeLogo = useCallback((): void => {
    logoRequestRef.current += 1
    revokeLocalAsset(logoUrlRef.current)
    dispatch({ type: 'REMOVE_LOGO' })
  }, [])

  const beginNewPresentation = useCallback((): void => {
    mediaInputRef.current?.click()
  }, [])

  const openSavedPresentation = useCallback(async (id: string): Promise<void> => {
    if (!window.cueport || openingPresentationId) return
    setOpeningPresentationId(id)
    try {
      const project = await window.cueport.openPresentation(id)
      const slides: SlideAsset[] = project.slides.map((slide) => ({
        id: slide.id,
        name: slide.name,
        url: slide.url,
        thumbnailUrl: slide.thumbnailUrl,
        width: slide.width,
        height: slide.height,
        mimeType: slide.mimeType,
        origin: 'local',
        sourceKey: slide.sourceKey
      }))
      const references: ReferenceAsset[] = project.references.map((reference) => ({
        id: reference.id,
        name: reference.name,
        url: reference.url,
        thumbnailUrl: reference.thumbnailUrl,
        width: reference.width,
        height: reference.height,
        mimeType: reference.mimeType,
        origin: 'local',
        sourceKey: reference.sourceKey
      }))
      const settings = parseStoredSettings(JSON.stringify(project.settings))
      lastNonPhoneFrameRef.current = settings.canvasFrame === 'phone' ? 'none' : settings.canvasFrame

      slidesRef.current.forEach(revokeSlideAsset)
      referencesRef.current.forEach(revokeSlideAsset)
      revokeLocalAsset(logoUrlRef.current)
      dispatch({
        type: 'RESTORE_PRESENTATION',
        slides,
        references,
        activeId: project.activeSlideId,
        settings,
        logo: project.brand
          ? { url: project.brand.url, name: project.brand.logoName, sourceKey: project.brand.sourceKey }
          : null
      })
      setZoom(1)
      setLeftPanelTab('sequence')
      setSavedPresentation({ id: project.summary.id, name: project.summary.name })
      setSavedProjectSnapshot(createProjectChangeSnapshot({
        settings,
        slides,
        references,
        logoName: project.brand?.logoName ?? null,
        logoSourceKey: project.brand?.sourceKey ?? null
      }))
      setIsHome(false)
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : 'The saved presentation could not be opened.')
    } finally {
      setOpeningPresentationId(null)
    }
  }, [openingPresentationId, showToast])

  const persistPresentation = useCallback(async (name: string): Promise<void> => {
    if (!window.cueport) throw new Error('Saving is available in the desktop app.')
    if (saveInFlightRef.current) return
    if (state.slides.length === 0) throw new Error('Add at least one image or video before saving.')

    saveInFlightRef.current = true
    try {
      const previewDataUrl = await createPresentationPreviewDataUrl(state.slides[0], state.brand.logoUrl)
      const slides = await Promise.all(state.slides.map(async (slide) => ({
        id: slide.id,
        name: slide.name,
        width: slide.width,
        height: slide.height,
        sourceKey: slide.sourceKey,
        thumbnailDataUrl: await createVideoPosterDataUrl(slide)
      })))
      const summary = await window.cueport.savePresentation({
        id: savedPresentation?.id ?? null,
        name,
        activeSlideId: state.activeId,
        settings: toStoredSettings(state),
        slides,
        references: state.references.map((reference) => ({
          id: reference.id,
          name: reference.name,
          width: reference.width,
          height: reference.height,
          sourceKey: reference.sourceKey,
          thumbnailDataUrl: null
        })),
        brand: { logoName: state.brand.logoName, sourceKey: state.brand.logoSourceKey },
        previewDataUrl
      })
      setSavedPresentation({ id: summary.id, name: summary.name })
      setSavedProjectSnapshot(currentProjectSnapshot)
      await refreshSavedPresentations()
      showToast('success', 'Presentation saved on this computer.')
    } catch (error) {
      const message = error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': /, '')
        : 'The presentation could not be saved.'
      showToast('error', message)
      throw new Error(message)
    } finally {
      saveInFlightRef.current = false
    }
  }, [currentProjectSnapshot, refreshSavedPresentations, savedPresentation?.id, showToast, state])

  const requestSavePresentation = useCallback((): void => {
    if (isHome || state.slides.length === 0) return
    if (savedPresentation) {
      void persistPresentation(savedPresentation.name)
      return
    }
    setPresentationNameRequest({ mode: 'save', initialName: 'Untitled presentation' })
  }, [isHome, persistPresentation, savedPresentation, state.slides.length])

  const requestRenamePresentation = useCallback((presentation: SavedPresentationSummary): void => {
    setPresentationNameRequest({ mode: 'rename', presentation })
  }, [])

  const renameSavedPresentation = useCallback(async (presentation: SavedPresentationSummary, name: string): Promise<void> => {
    if (!window.cueport) throw new Error('Renaming is available in the desktop app.')
    try {
      const summary = await window.cueport.renamePresentation(presentation.id, name)
      if (savedPresentation?.id === summary.id) setSavedPresentation({ id: summary.id, name: summary.name })
      await refreshSavedPresentations()
      showToast('success', 'Presentation renamed.')
    } catch (error) {
      const message = error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': /, '')
        : 'The presentation could not be renamed.'
      throw new Error(message)
    }
  }, [refreshSavedPresentations, savedPresentation?.id, showToast])

  const deleteSavedPresentation = useCallback(async (presentation: SavedPresentationSummary): Promise<void> => {
    if (!window.cueport) throw new Error('Deleting is available in the desktop app.')
    try {
      await window.cueport.deletePresentation(presentation.id)
      setSavedPresentations((current) => current.filter((candidate) => candidate.id !== presentation.id))
      if (savedPresentation?.id === presentation.id) {
        setSavedPresentation(null)
        setSavedProjectSnapshot(null)
      }
      showToast('success', 'Presentation deleted from this computer.')
    } catch (error) {
      const message = error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+': /, '')
        : 'The presentation could not be deleted.'
      throw new Error(message)
    }
  }, [savedPresentation?.id, showToast])

  const moveSavedPresentation = useCallback((fromIndex: number, toIndex: number): void => {
    const next = moveItem(savedPresentations, fromIndex, toIndex)
    if (next.every((presentation, index) => presentation.id === savedPresentations[index]?.id)) return
    setSavedPresentations(next)
    if (!window.cueport) return

    const ids = next.map((presentation) => presentation.id)
    presentationOrderWriteRef.current = presentationOrderWriteRef.current
      .catch(() => undefined)
      .then(() => window.cueport!.reorderPresentations(ids))
      .catch((error) => {
        showToast('error', error instanceof Error ? error.message : 'The presentation order could not be saved.')
        void refreshSavedPresentations()
      })
  }, [refreshSavedPresentations, savedPresentations, showToast])

  const changeCanvasFrame = useCallback((frame: CanvasFrame): void => {
    if (frame !== 'phone') lastNonPhoneFrameRef.current = frame
    dispatch({ type: 'SET_CANVAS_FRAME', frame })
  }, [])

  const changeViewportCategory = useCallback((category: ViewportCategory, viewport: ViewportSize): void => {
    dispatch({ type: 'SET_VIEWPORT', viewport })
    dispatch({
      type: 'SET_CANVAS_FRAME',
      frame: category === 'Mobile' ? 'phone' : lastNonPhoneFrameRef.current
    })
  }, [])

  const updateFitWidthMeasurement = useCallback((slideId: string, width: number): void => {
    setFitWidthMeasurement((current) => (
      current?.slideId === slideId && current.width === width ? current : { slideId, width }
    ))
  }, [])

  const setChromeMode = useCallback((mode: ChromeMode): void => {
    chromeModeRef.current = mode
    dispatch({ type: 'SET_CHROME_MODE', mode })
    if (mode === 'hidden') {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-active-scroll="true"]')?.focus({ preventScroll: true })
      })
    } else {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.top-bar')?.focus({ preventScroll: true })
      })
    }
  }, [])

  const completeReturnToPresentationHome = useCallback((): void => {
    setChromeMode('all')
    setIsHome(true)
    void refreshSavedPresentations()
  }, [refreshSavedPresentations, setChromeMode])

  const requestReturnToPresentationHome = useCallback((): void => {
    if (isPresentationDirty) {
      setIsUnsavedPromptOpen(true)
      return
    }
    completeReturnToPresentationHome()
  }, [completeReturnToPresentationHome, isPresentationDirty])

  const saveBeforeReturningHome = useCallback(async (): Promise<void> => {
    if (!savedPresentation) {
      setIsUnsavedPromptOpen(false)
      setReturnHomeAfterSave(true)
      setPresentationNameRequest({ mode: 'save', initialName: 'Untitled presentation' })
      return
    }

    setIsSavingOnExit(true)
    try {
      await persistPresentation(savedPresentation.name)
      setIsUnsavedPromptOpen(false)
      completeReturnToPresentationHome()
    } catch {
      // persistPresentation already explains the failure in the application.
    } finally {
      setIsSavingOnExit(false)
    }
  }, [completeReturnToPresentationHome, persistPresentation, savedPresentation])

  const handleHShortcut = useCallback((): void => {
    if (hShortcutTimerRef.current !== null) {
      window.clearTimeout(hShortcutTimerRef.current)
      hShortcutTimerRef.current = null
      setChromeMode(toggleCompleteInterface(chromeModeRef.current))
      return
    }

    hShortcutTimerRef.current = window.setTimeout(() => {
      hShortcutTimerRef.current = null
      setChromeMode(toggleSidePanels(chromeModeRef.current))
    }, 500)
  }, [setChromeMode])

  const toggleAllInterface = useCallback((): void => {
    if (hShortcutTimerRef.current !== null) {
      window.clearTimeout(hShortcutTimerRef.current)
      hShortcutTimerRef.current = null
    }
    setChromeMode(toggleCompleteInterface(chromeModeRef.current))
  }, [setChromeMode])

  const isAnyChromeVisible = state.chromeMode !== 'hidden'
  const isSequenceVisible = state.chromeMode === 'all' || state.chromeMode === 'sequence'
  const isSettingsVisible = state.chromeMode === 'all' || state.chromeMode === 'settings'

  const changeDisplayMode = useCallback((mode: DisplayMode): void => {
    if (mode === state.mode) return
    runCanvasTransition(
      'mode',
      () => dispatch({ type: 'SET_MODE', mode }),
      () => document.querySelector<HTMLElement>('[data-active-scroll="true"]')?.scrollTo({ top: 0, left: 0 })
    )
  }, [runCanvasTransition, state.mode])

  const toggleViewport = useCallback((): void => {
    runCanvasTransition('mode', () => {
      dispatch({ type: 'SET_VIEWPORT_ENABLED', value: !state.viewportEnabled })
    })
  }, [runCanvasTransition, state.viewportEnabled])

  const resetCanvasZoom = useCallback((): void => {
    if (state.mode === 'canvas') {
      setZoom(1)
      return
    }
    runCanvasTransition('mode', () => {
      setZoom(1)
      dispatch({ type: 'SET_MODE', mode: 'canvas' })
    })
  }, [runCanvasTransition, state.mode])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const commandKey = event.metaKey || event.ctrlKey

      if (commandKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!event.repeat && !presentationNameRequest) requestSavePresentation()
        return
      }
      if (isHome) return

      if (event.key === 'Escape') {
        if (state.isHelpOpen) dispatch({ type: 'SET_HELP_OPEN', value: false })
        else if (isAnyChromeVisible) setChromeMode('hidden')
        return
      }
      if (state.isHelpOpen) {
        if (event.key === '?') {
          event.preventDefault()
          dispatch({ type: 'SET_HELP_OPEN', value: false })
        }
        return
      }
      if (isTextInput(event.target)) return

      if (commandKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        mediaInputRef.current?.click()
      } else if (
        event.key.toLowerCase() === 'h' &&
        !commandKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.repeat
      ) {
        event.preventDefault()
        handleHShortcut()
      } else if (event.key === '?') {
        event.preventDefault()
        dispatch({ type: 'SET_HELP_OPEN', value: !state.isHelpOpen })
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setActiveByOffset(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setActiveByOffset(1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        document.querySelector<HTMLElement>('[data-active-scroll="true"]')?.scrollTo({ top: 0, behavior: 'smooth' })
        } else if (
          !commandKey &&
          !event.altKey &&
          !event.shiftKey &&
          !event.repeat &&
          ['f', 'g'].includes(event.key.toLowerCase())
        ) {
          event.preventDefault()
          changeDisplayMode(event.key.toLowerCase() === 'f' ? 'canvas' : 'fit-width')
        } else if (event.key === '0') {
        event.preventDefault()
        resetCanvasZoom()
      } else if (
        event.key.toLowerCase() === 'v' &&
        !commandKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.repeat
      ) {
        event.preventDefault()
        toggleViewport()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeDisplayMode, handleHShortcut, isAnyChromeVisible, isHome, presentationNameRequest, requestSavePresentation, resetCanvasZoom, setActiveByOffset, setChromeMode, state.isHelpOpen, toggleViewport])

  const handleDragEnter = (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDropActive(true)
  }

  const handleDragLeave = (event: React.DragEvent): void => {
    if (!event.dataTransfer.types.includes('Files')) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDropActive(false)
  }

  const handleDrop = (event: React.DragEvent): void => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDropActive(false)
    void importMedia(
      event.dataTransfer.files,
      isHome ? 'sequence' : leftPanelTab,
      isHome
    )
  }

  return (
    <div
      className={`app-shell chrome-${state.chromeMode}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.dataTransfer.types.includes('Files') && event.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        accept=".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"
        hidden
        multiple
        onChange={(event) => {
          if (event.target.files) {
            void importMedia(event.target.files, 'sequence', isHome)
          }
          event.target.value = ''
        }}
        ref={mediaInputRef}
        type="file"
      />
      <input
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        hidden
        multiple
        onChange={(event) => {
          if (event.target.files) void importMedia(event.target.files, 'references')
          event.target.value = ''
        }}
        ref={referenceInputRef}
        type="file"
      />

      <TopBar
        activeSlide={activeSlide}
        displayResolution={displayResolution}
        isChromeVisible={isAnyChromeVisible}
        isHome={isHome}
        isInert={state.isHelpOpen}
        mode={state.mode}
        onGoHome={requestReturnToPresentationHome}
        onModeChange={changeDisplayMode}
        onSequenceTitlesChange={(patch) => dispatch({ type: 'PATCH_SEQUENCE_TITLES', patch })}
        onToggleChrome={toggleAllInterface}
        onViewportToggle={toggleViewport}
        onViewportMarkerChange={(marker) => dispatch({ type: 'SET_VIEWPORT_MARKER', marker })}
        onZoomReset={resetCanvasZoom}
        sequenceTitles={state.sequenceTitles}
        viewport={state.viewport}
        viewportEnabled={state.viewportEnabled}
        viewportMarker={state.viewportMarker}
        zoom={zoom}
      />

      {isHome ? (
        <HomeScreen
          isLoading={isLoadingPresentations}
          onDelete={deleteSavedPresentation}
          onMove={moveSavedPresentation}
          onNew={beginNewPresentation}
          onOpen={(id) => void openSavedPresentation(id)}
          onRename={requestRenamePresentation}
          openingId={openingPresentationId}
          presentations={savedPresentations}
        />
      ) : <div className="workspace" inert={state.isHelpOpen ? true : undefined}>
        <div
          aria-hidden={!isSequenceVisible || state.isHelpOpen}
          className="chrome-drawer chrome-drawer-left"
          id="sequence-drawer"
          inert={!isSequenceVisible || state.isHelpOpen ? true : undefined}
        >
          <Filmstrip
            activeTab={leftPanelTab}
            activeId={state.activeId}
            onChooseMedia={() => mediaInputRef.current?.click()}
            onChooseReferences={() => referenceInputRef.current?.click()}
            onMove={(fromIndex, toIndex) => dispatch({ type: 'MOVE_SLIDE', fromIndex, toIndex })}
            onMoveReference={(fromIndex, toIndex) => dispatch({ type: 'MOVE_REFERENCE', fromIndex, toIndex })}
            onRemove={removeSlide}
            onRemoveReference={removeReference}
            onRename={renameSlide}
            onSelect={selectSlide}
            onTabChange={setLeftPanelTab}
            references={state.references}
            sequenceTitles={state.sequenceTitles}
            slides={state.slides}
          />
        </div>

        <Stage
          background={state.background}
          brand={state.brand}
          chromeMode={state.chromeMode}
          canvasFrame={state.canvasFrame}
          canvasImageGlow={state.canvasImageGlow}
          referenceImageShadow={state.referenceImageShadow}
          canvasRoundedCorners={state.canvasRoundedCorners}
          canvasStartAtTop={state.canvasStartAtTop}
          phoneBrowserBars={state.phoneBrowserBars}
          programBarColor={state.programBarColor}
          canNavigateNext={activeIndex >= 0 && activeIndex < state.slides.length - 1}
          canNavigatePrevious={activeIndex > 0}
          isImporting={isImporting}
          mode={state.mode}
          onChooseMedia={() => mediaInputRef.current?.click()}
          onNavigate={setActiveByOffset}
          onFitWidthChange={updateFitWidthMeasurement}
          references={state.references}
          slide={activeSlide}
          viewport={state.viewport}
          viewportMarker={state.viewportMarker}
          viewportEnabled={state.viewportEnabled}
          zoom={zoom}
          onZoomChange={setZoom}
        />

        <div
          aria-hidden={!isSettingsVisible || state.isHelpOpen}
          className="chrome-drawer chrome-drawer-right"
          id="settings-drawer"
          inert={!isSettingsVisible || state.isHelpOpen ? true : undefined}
        >
          <Inspector
            background={state.background}
            brand={state.brand}
            canvasFrame={state.canvasFrame}
            canvasImageGlow={state.canvasImageGlow}
            referenceImageShadow={state.referenceImageShadow}
            canvasRoundedCorners={state.canvasRoundedCorners}
            canvasStartAtTop={state.canvasStartAtTop}
            phoneBrowserBars={state.phoneBrowserBars}
            programBarColor={state.programBarColor}
            onBackgroundChange={setBackground}
            onCanvasFrameChange={changeCanvasFrame}
            onCanvasImageGlowChange={(value: boolean) => dispatch({ type: 'SET_CANVAS_IMAGE_GLOW', value })}
            onReferenceImageShadowChange={(value: boolean) => dispatch({ type: 'SET_REFERENCE_IMAGE_SHADOW', value })}
            onCanvasRoundedCornersChange={(value: boolean) => dispatch({ type: 'SET_CANVAS_ROUNDED_CORNERS', value })}
            onCanvasStartAtTopChange={(value: boolean) => dispatch({ type: 'SET_CANVAS_START_AT_TOP', value })}
            onPhoneBrowserBarsChange={(patch) => dispatch({ type: 'PATCH_PHONE_BROWSER_BARS', patch })}
            onProgramBarColorChange={setProgramBarColor}
            onLogoFile={(file) => void addLogo(file)}
            onPatchBrand={(patch: Partial<{ position: LogoPosition; width: number; opacity: number; margin: number; showOnCanvas: boolean }>) => dispatch({ type: 'PATCH_BRAND', patch })}
            onRemoveLogo={removeLogo}
            onViewportCategoryChange={changeViewportCategory}
            onViewportChange={(viewport: ViewportSize) => dispatch({ type: 'SET_VIEWPORT', viewport })}
            viewport={state.viewport}
            viewportEnabled={state.viewportEnabled}
          />
        </div>
      </div>}

      {isDropActive && (
        <div className="drop-overlay">
          <div>
            <IconDrop />
            <strong>Release to add to {isHome || leftPanelTab === 'sequence' ? 'the sequence' : 'References'}</strong>
            <span>{isHome || leftPanelTab === 'sequence' ? 'JPEG, PNG, WebP, or MP4' : 'JPEG, PNG, or WebP'}</span>
          </div>
        </div>
      )}

      {state.isHelpOpen && <HelpDialog onClose={() => dispatch({ type: 'SET_HELP_OPEN', value: false })} />}
      {isUnsavedPromptOpen && (
        <UnsavedChangesDialog
          isSavedPresentation={savedPresentation !== null}
          isSaving={isSavingOnExit}
          onCancel={() => setIsUnsavedPromptOpen(false)}
          onDiscard={() => {
            setIsUnsavedPromptOpen(false)
            completeReturnToPresentationHome()
          }}
          onSave={() => void saveBeforeReturningHome()}
        />
      )}
      {presentationNameRequest && (
        <PresentationNameDialog
          initialName={presentationNameRequest.mode === 'save'
            ? presentationNameRequest.initialName
            : presentationNameRequest.presentation.name}
          mode={presentationNameRequest.mode}
          onCancel={() => {
            setPresentationNameRequest(null)
            setReturnHomeAfterSave(false)
          }}
          onSubmit={async (name) => {
            if (presentationNameRequest.mode === 'rename') {
              await renameSavedPresentation(presentationNameRequest.presentation, name)
              return
            }
            await persistPresentation(name)
            if (returnHomeAfterSave) {
              setReturnHomeAfterSave(false)
              completeReturnToPresentationHome()
            }
          }}
        />
      )}
      {toast && <Toast onDismiss={() => setToast(null)} toast={toast} />}
    </div>
  )
}

function IconDrop(): React.JSX.Element {
  return (
    <svg aria-hidden="true" fill="none" height="28" viewBox="0 0 32 32" width="28">
      <path d="M16 22V7m0 0-6 6m6-6 6 6M7 20v5h18v-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  )
}
