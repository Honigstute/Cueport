import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { formatZoom } from '../../../../src/renderer/src/lib/zoom'
import type { DisplayMode, SlideAsset } from '../../../../src/renderer/src/types'
import { sharedViewerThumbnailCache } from './viewerThumbnailCache'

interface ViewerControlsProps {
  activeSlideIndex: number
  canEdit: boolean
  canComment: boolean
  commentsEnabled: boolean
  downloadUrl: string
  editorDirty: boolean
  editorSavePhase: 'idle' | 'preparing' | 'uploading' | 'finalizing' | 'saved'
  isVisible: boolean
  mode: DisplayMode
  slides: SlideAsset[]
  workspaceMode: 'presentation' | 'edit'
  viewportEnabled: boolean
  viewportHeight: number
  viewportMarker: number | null
  zoom: number
  onCommentsToggle: () => void
  onEditorSave: () => void
  onHome: () => void
  onModeChange: (mode: DisplayMode) => void
  onSlideSelect: (index: number) => void
  onViewportToggle: () => void
  onViewportMarkerChange: (marker: number | null) => void
  onWorkspaceModeChange: (mode: 'presentation' | 'edit') => void
  onZoomReset: () => void
}

interface ViewerThumbnailPolicy {
  fetchPriority: 'high' | 'low'
  loading: 'eager' | 'lazy'
}

/** A persisted poster is always preferred over a generated legacy preview. */
export function viewerThumbnailUrl(slide: SlideAsset): string | null {
  return slide.thumbnailUrl && slide.thumbnailUrl !== slide.url ? slide.thumbnailUrl : null
}

/** Generate missing previews only for media the renderer is already warming. */
export function shouldGenerateLegacyViewerThumbnail(slide: SlideAsset, index: number, activeIndex: number): boolean {
  return !viewerThumbnailUrl(slide) &&
    slide.mimeType !== 'video/mp4' &&
    Boolean(slide.url) &&
    Math.abs(index - activeIndex) <= 1
}

/** Warm the active screen and its neighbors; keep every distant preview lazy. */
export function viewerThumbnailPolicy(index: number, activeIndex: number): ViewerThumbnailPolicy {
  const distance = Math.abs(index - activeIndex)
  return {
    loading: distance <= 1 ? 'eager' : 'lazy',
    fetchPriority: distance === 0 ? 'high' : 'low'
  }
}

function ViewerSlideThumbnail({
  activeIndex,
  index,
  onSelect,
  slide
}: {
  activeIndex: number
  index: number
  onSelect: (index: number) => void
  slide: SlideAsset
}): React.JSX.Element {
  const posterUrl = viewerThumbnailUrl(slide)
  const shouldGenerate = shouldGenerateLegacyViewerThumbnail(slide, index, activeIndex)
  const [generated, setGenerated] = useState<{ sourceUrl: string; thumbnailUrl: string } | null>(null)
  const mountedRef = useRef(false)
  const currentSourceRef = useRef(slide.url)
  const policy = viewerThumbnailPolicy(index, activeIndex)
  currentSourceRef.current = slide.url

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (posterUrl || !shouldGenerate || generated?.sourceUrl === slide.url) return
    const sourceUrl = slide.url
    void sharedViewerThumbnailCache.get(sourceUrl).then((thumbnailUrl) => {
      if (!thumbnailUrl || !mountedRef.current || currentSourceRef.current !== sourceUrl) return
      setGenerated({ sourceUrl, thumbnailUrl })
    })
  }, [generated?.sourceUrl, posterUrl, shouldGenerate, slide.url])

  const generatedUrl = generated?.sourceUrl === slide.url ? generated.thumbnailUrl : null
  const thumbnailUrl = posterUrl || generatedUrl

  return (
    <button
      aria-current={index === activeIndex ? 'page' : undefined}
      aria-label={`Show screen ${index + 1}: ${slide.name}`}
      className="web-viewer-slide-thumbnail"
      data-active={index === activeIndex}
      onClick={() => onSelect(index)}
      title={`${index + 1}. ${slide.name}`}
      type="button"
    >
      {thumbnailUrl ? (
        <img
          alt=""
          decoding="async"
          draggable={false}
          fetchPriority={policy.fetchPriority}
          height={22}
          loading={policy.loading}
          src={thumbnailUrl}
          width={30}
        />
      ) : (
        <span aria-hidden="true" className="web-viewer-slide-thumbnail-fallback">
          <Icon name={slide.mimeType === 'video/mp4' ? 'play' : 'image'} size={13} />
        </span>
      )}
    </button>
  )
}

export function ViewerControls({
  activeSlideIndex,
  canEdit,
  canComment,
  commentsEnabled,
  downloadUrl,
  editorDirty,
  editorSavePhase,
  isVisible,
  mode,
  slides,
  workspaceMode,
  viewportEnabled,
  viewportHeight,
  viewportMarker,
  zoom,
  onCommentsToggle,
  onEditorSave,
  onHome,
  onModeChange,
  onSlideSelect,
  onViewportToggle,
  onViewportMarkerChange,
  onWorkspaceModeChange,
  onZoomReset
}: ViewerControlsProps): React.JSX.Element {
  const slideStripRef = useRef<HTMLElement>(null)
  const [foldDraft, setFoldDraft] = useState(viewportMarker?.toString() ?? '')
  const foldIsInvalid = foldDraft !== '' && (
    Number(foldDraft) <= 0 || Number(foldDraft) >= viewportHeight
  )
  const isSaving = editorSavePhase === 'preparing' || editorSavePhase === 'uploading' || editorSavePhase === 'finalizing'
  const saveLabel = editorSavePhase === 'preparing'
    ? 'Preparing…'
    : editorSavePhase === 'uploading'
      ? 'Uploading…'
      : editorSavePhase === 'finalizing'
        ? 'Finishing…'
        : editorSavePhase === 'saved'
          ? 'Saved'
          : 'Save changes'

  useEffect(() => {
    setFoldDraft(viewportMarker?.toString() ?? '')
  }, [viewportMarker])

  useEffect(() => {
    const strip = slideStripRef.current
    const active = strip?.children.item(activeSlideIndex)
    if (!(strip && active instanceof HTMLElement)) return
    const keepKeyboardFocusWithActiveSlide = strip.contains(document.activeElement)
    if (active.offsetLeft < strip.scrollLeft) {
      strip.scrollLeft = active.offsetLeft
    } else if (active.offsetLeft + active.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = active.offsetLeft + active.offsetWidth - strip.clientWidth
    }
    if (keepKeyboardFocusWithActiveSlide && active !== document.activeElement) {
      active.focus({ preventScroll: true })
    }
  }, [activeSlideIndex])

  const updateFold = (value: string): void => {
    const digits = value.replace(/\D/g, '').slice(0, 5)
    setFoldDraft(digits)
    if (!digits) {
      onViewportMarkerChange(null)
      return
    }
    const marker = Number(digits)
    if (marker > 0 && marker < viewportHeight) onViewportMarkerChange(marker)
  }

  return (
    <header
      aria-hidden={!isVisible}
      aria-label="Cueport controls"
      className={`top-bar web-viewer-top-bar${isVisible ? '' : ' web-viewer-top-bar-hidden'}`}
      inert={!isVisible ? true : undefined}
    >
      <div className="top-bar-content web-viewer-top-bar-content">
        <div className="document-context web-viewer-document-context">
          <button className="icon-button web-viewer-home" onClick={onHome} title="Back to presentations" type="button">
            <Icon name="home" size={17} />
            <span className="sr-only">Back to presentations</span>
          </button>
          {canComment && (
            <button
              aria-label={commentsEnabled ? 'Hide comments' : 'Show comments'}
              aria-pressed={commentsEnabled}
              className="icon-button web-viewer-comments"
              data-active={commentsEnabled}
              onClick={onCommentsToggle}
              title={`${commentsEnabled ? 'Hide' : 'Show'} comments · C`}
              type="button"
            >
              <Icon name="comment" size={17} />
            </button>
          )}
          <a className="icon-button web-viewer-download" download href={downloadUrl} title="Download full presentation (.zip)">
            <Icon name="download" size={17} />
            <span className="sr-only">Download full presentation</span>
          </a>
          {canEdit && (
            <>
              <span aria-hidden="true" className="top-bar-divider web-editor-divider" />
              <div aria-label="Workspace mode" className="web-workspace-mode" role="group">
                <button
                  aria-pressed={workspaceMode === 'presentation'}
                  data-active={workspaceMode === 'presentation'}
                  onClick={() => onWorkspaceModeChange('presentation')}
                  title="Presentation mode"
                  type="button"
                >
                  <Icon name="eye" size={15} />
                  <span>Present</span>
                </button>
                <button
                  aria-pressed={workspaceMode === 'edit'}
                  data-active={workspaceMode === 'edit'}
                  onClick={() => onWorkspaceModeChange('edit')}
                  title="Edit presentation"
                  type="button"
                >
                  <Icon name="edit" size={15} />
                  <span>Edit</span>
                </button>
              </div>
              <button
                className="web-editor-save"
                data-dirty={editorDirty}
                disabled={workspaceMode !== 'edit' || isSaving || (!editorDirty && editorSavePhase !== 'saved')}
                onClick={onEditorSave}
                title={editorDirty ? 'Save changes to the web presentation' : 'No unsaved changes'}
                type="button"
              >
                <Icon name={editorSavePhase === 'saved' ? 'check' : 'upload'} size={15} />
                <span>{saveLabel}</span>
              </button>
            </>
          )}
        </div>

        <div aria-label="View controls" className="view-controls">
          <div
            aria-hidden={mode !== 'canvas'}
            aria-label="Canvas options"
            className="canvas-options"
            data-visible={mode === 'canvas'}
            inert={mode !== 'canvas' ? true : undefined}
            role="group"
          >
            {viewportEnabled && (
              <label className="topbar-viewport-marker" data-invalid={foldIsInvalid}>
                <span>Set fold</span>
                <input
                  aria-invalid={foldIsInvalid}
                  aria-label="Set fold in pixels"
                  inputMode="numeric"
                  maxLength={4}
                  onBlur={() => foldIsInvalid && setFoldDraft(viewportMarker?.toString() ?? '')}
                  onChange={(event) => updateFold(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                  value={foldDraft}
                />
                <span>px</span>
              </label>
            )}
            <button
              aria-checked={viewportEnabled}
              className="view-option-button"
              data-active={viewportEnabled}
              onClick={onViewportToggle}
              role="switch"
              title="Show or hide viewport · V"
              type="button"
            >
              <span className="viewport-toggle-label">Viewport</span>
              <span aria-hidden="true" className="toggle-track"><span className="toggle-thumb" /></span>
            </button>
            <button
              className="zoom-level-button"
              data-actual={zoom === 1}
              onClick={onZoomReset}
              title="Show canvas at actual pixels · 0"
              type="button"
            >
              {formatZoom(zoom)}
            </button>
          </div>

          <div aria-label="View mode" className="mode-switcher" role="group">
            <button
              aria-pressed={mode === 'canvas'}
              className="mode-button"
              data-active={mode === 'canvas'}
              onClick={() => onModeChange('canvas')}
              title="Canvas · F"
              type="button"
            >
              <Icon name="zoom" size={16} />
              <span>Canvas</span>
            </button>
            <button
              aria-pressed={mode === 'fit-width'}
              className="mode-button"
              data-active={mode === 'fit-width'}
              onClick={() => onModeChange('fit-width')}
              title="Fit width · G"
              type="button"
            >
              <Icon name="fit-width" size={16} />
              <span>Fit width</span>
            </button>
          </div>
        </div>

        <div className="top-actions web-viewer-top-actions">
          <nav
            aria-label="Presentation screens"
            className="web-viewer-slide-strip"
            onWheel={(event) => {
              if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
              event.preventDefault()
              event.currentTarget.scrollLeft += event.deltaY
            }}
            ref={slideStripRef}
          >
            {slides.map((slide, index) => (
              <ViewerSlideThumbnail
                activeIndex={activeSlideIndex}
                index={index}
                key={slide.id}
                onSelect={onSlideSelect}
                slide={slide}
              />
            ))}
          </nav>
        </div>
      </div>
    </header>
  )
}
