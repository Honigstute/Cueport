import { useEffect, useState } from 'react'
import { Icon } from '../../../../src/renderer/src/components/Icon'
import { formatZoom } from '../../../../src/renderer/src/lib/zoom'
import type { DisplayMode } from '../../../../src/renderer/src/types'

interface ViewerControlsProps {
  mode: DisplayMode
  viewportEnabled: boolean
  viewportHeight: number
  viewportMarker: number | null
  zoom: number
  onModeChange: (mode: DisplayMode) => void
  onViewportToggle: () => void
  onViewportMarkerChange: (marker: number | null) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

export function ViewerControls({
  mode,
  viewportEnabled,
  viewportHeight,
  viewportMarker,
  zoom,
  onModeChange,
  onViewportToggle,
  onViewportMarkerChange,
  onZoomIn,
  onZoomOut,
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
    <nav aria-label="Presentation view" className="viewer-controls">
      <div aria-label="View mode" className="viewer-control-group viewer-mode-switcher" role="group">
        <button
          aria-pressed={mode === 'canvas'}
          data-active={mode === 'canvas'}
          onClick={() => onModeChange('canvas')}
          title="Canvas view · F"
          type="button"
        >
          <Icon name="zoom" size={16} />
          <span>Canvas</span>
        </button>
        <button
          aria-pressed={mode === 'fit-width'}
          data-active={mode === 'fit-width'}
          onClick={() => onModeChange('fit-width')}
          title="Fit width · G"
          type="button"
        >
          <Icon name="fit-width" size={16} />
          <span>Fit width</span>
        </button>
      </div>

      {mode === 'canvas' && (
        <>
          <span aria-hidden="true" className="viewer-control-divider" />
          <div className="viewer-control-group viewer-canvas-controls">
            {viewportEnabled && (
              <label className="viewer-fold" data-invalid={foldIsInvalid}>
                <span>Set fold</span>
                <input
                  aria-invalid={foldIsInvalid}
                  aria-label="Set fold in pixels"
                  inputMode="numeric"
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
              className="viewer-viewport-toggle"
              data-active={viewportEnabled}
              onClick={onViewportToggle}
              role="switch"
              title="Show or hide viewport · V"
              type="button"
            >
              <Icon name="viewport" size={16} />
              <span>Viewport</span>
              <i aria-hidden="true"><b /></i>
            </button>
          </div>
          <span aria-hidden="true" className="viewer-control-divider" />
          <div aria-label="Zoom" className="viewer-control-group viewer-zoom-controls" role="group">
            <button aria-label="Zoom out" onClick={onZoomOut} title="Zoom out · −" type="button">−</button>
            <button className="viewer-zoom-level" onClick={onZoomReset} title="Actual size · 0" type="button">
              {formatZoom(zoom)}
            </button>
            <button aria-label="Zoom in" onClick={onZoomIn} title="Zoom in · +" type="button">+</button>
          </div>
        </>
      )}
    </nav>
  )
}
