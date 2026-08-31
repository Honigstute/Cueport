import { useEffect, useState } from 'react'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { formatZoom } from '../../../../src/renderer/src/lib/zoom'
import type { DisplayMode } from '../../../../src/renderer/src/types'

interface ViewerControlsProps {
  commentsEnabled: boolean
  downloadUrl: string
  isVisible: boolean
  mode: DisplayMode
  viewportEnabled: boolean
  viewportHeight: number
  viewportMarker: number | null
  zoom: number
  onCommentsToggle: () => void
  onModeChange: (mode: DisplayMode) => void
  onViewportToggle: () => void
  onViewportMarkerChange: (marker: number | null) => void
  onZoomReset: () => void
}

export function ViewerControls({
  commentsEnabled,
  downloadUrl,
  isVisible,
  mode,
  viewportEnabled,
  viewportHeight,
  viewportMarker,
  zoom,
  onCommentsToggle,
  onModeChange,
  onViewportToggle,
  onViewportMarkerChange,
  onZoomReset
}: ViewerControlsProps): React.JSX.Element {
  const [foldDraft, setFoldDraft] = useState(viewportMarker?.toString() ?? '')
  const foldIsInvalid = foldDraft !== '' && (
    Number(foldDraft) <= 0 || Number(foldDraft) >= viewportHeight
  )

  useEffect(() => {
    setFoldDraft(viewportMarker?.toString() ?? '')
  }, [viewportMarker])

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
          <a className="icon-button web-viewer-home" href="/" title="Back to presentations">
            <Icon name="home" size={17} />
            <span className="sr-only">Back to presentations</span>
          </a>
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
          <a className="icon-button web-viewer-download" download href={downloadUrl} title="Download sequence">
            <Icon name="download" size={17} />
            <span className="sr-only">Download sequence</span>
          </a>
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

        <div aria-hidden="true" className="top-actions web-viewer-top-actions" />
      </div>
    </header>
  )
}
