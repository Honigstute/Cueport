import { useEffect, useRef, useState } from 'react'
import { formatDimensions } from '../lib/assets'
import type { DisplayResolution } from '../lib/displayResolution'
import { formatZoom } from '../lib/zoom'
import type { DisplayMode, SequenceTitleSettings, SlideAsset, ViewportSize } from '../types'
import type { PublishingStatus } from '../../../shared/projects'
import { Icon, type IconName } from './Icon'
import { SettingToggle } from './SettingToggle'

interface TopBarProps {
  activeSlide: SlideAsset | null
  isHome: boolean
  isChromeVisible: boolean
  mode: DisplayMode
  isInert: boolean
  viewportEnabled: boolean
  viewport: ViewportSize
  viewportMarker: number | null
  sequenceTitles: SequenceTitleSettings
  zoom: number
  displayResolution: DisplayResolution | null
  publishingStatus: PublishingStatus | null
  onGoHome: () => void
  onPublish: () => void
  onModeChange: (mode: DisplayMode) => void
  onPublishingAccount: () => void
  onSequenceTitlesChange: (patch: Partial<SequenceTitleSettings>) => void
  onToggleChrome: () => void
  onViewportToggle: () => void
  onViewportMarkerChange: (marker: number | null) => void
  onZoomReset: () => void
}

const MODE_OPTIONS: { id: DisplayMode; label: string; icon: IconName; shortcut: string }[] = [
  { id: 'canvas', label: 'Canvas', icon: 'zoom', shortcut: 'F' },
  { id: 'fit-width', label: 'Fit width', icon: 'fit-width', shortcut: 'G' }
]

export function TopBar({
  activeSlide,
  isHome,
  isChromeVisible,
  mode,
  isInert,
  viewportEnabled,
  viewport,
  viewportMarker,
  sequenceTitles,
  zoom,
  displayResolution,
  publishingStatus,
  onGoHome,
  onPublish,
  onModeChange,
  onPublishingAccount,
  onSequenceTitlesChange,
  onToggleChrome,
  onViewportToggle,
  onViewportMarkerChange,
  onZoomReset
}: TopBarProps): React.JSX.Element {
  const settingsRef = useRef<HTMLDivElement>(null)
  const [isSequenceSettingsOpen, setIsSequenceSettingsOpen] = useState(false)

  useEffect(() => {
    if (!isSequenceSettingsOpen) return
    const closeOutside = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !settingsRef.current?.contains(event.target)) {
        setIsSequenceSettingsOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsSequenceSettingsOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [isSequenceSettingsOpen])

  useEffect(() => {
    if (!isChromeVisible) setIsSequenceSettingsOpen(false)
  }, [isChromeVisible])

  return (
    <header aria-label={isHome ? 'Cueport' : 'Cueport controls'} className={`top-bar${isHome ? ' top-bar-home' : ''}`} tabIndex={-1}>
      <div aria-hidden={isInert} className="top-bar-content" data-home={isHome} inert={isInert ? true : undefined}>
        {isHome ? (
          <>
            <div className="brand-lockup" aria-label="Cueport">
              <span className="brand-mark"><Icon name="target" size={16} /></span>
              <span className="brand-word">cueport</span>
            </div>
            <button
              className="icon-button publishing-account-button"
              data-active={publishingStatus?.signedIn}
              onClick={onPublishingAccount}
              title={publishingStatus?.signedIn ? `Desktop account · ${publishingStatus.email}` : 'Sign in for publishing'}
              type="button"
            >
              <Icon name="user" size={17} />
              <span className="sr-only">Desktop publishing account</span>
            </button>
          </>
        ) : (
          <div
            aria-hidden={!isChromeVisible}
            className="document-context"
            inert={!isChromeVisible ? true : undefined}
          >
            <div className="brand-lockup" aria-label="Cueport">
              <span className="brand-mark"><Icon name="target" size={16} /></span>
              <span className="brand-word">cueport</span>
            </div>
            <div className="toolbar-settings-wrap" ref={settingsRef}>
              <button
                aria-controls="sequence-settings-popover"
                aria-expanded={isSequenceSettingsOpen}
                className="icon-button toolbar-settings"
                data-active={isSequenceSettingsOpen}
                onClick={() => setIsSequenceSettingsOpen((open) => !open)}
                title="Sequence title settings"
                type="button"
              >
                <Icon name="settings" size={17} />
                <span className="sr-only">Sequence title settings</span>
              </button>
              {isSequenceSettingsOpen && (
                <section
                  aria-labelledby="sequence-settings-title"
                  className="sequence-settings-popover"
                  id="sequence-settings-popover"
                  role="dialog"
                >
                  <div className="rename-dialog-copy">
                    <span className="eyebrow">Presentation</span>
                    <h2 id="sequence-settings-title">Sequence titles</h2>
                  </div>
                  <div className="sequence-title-options">
                    <SettingToggle
                      checked={sequenceTitles.hideExtension}
                      description="Remove PNG, JPEG, WebP, and MP4 endings"
                      label="Hide file endings"
                      onChange={(hideExtension) => onSequenceTitlesChange({ hideExtension })}
                    />
                    <SettingToggle
                      checked={sequenceTitles.preferEnding}
                      description="Shorten long names from the beginning"
                      label="Keep title endings visible"
                      onChange={(preferEnding) => onSequenceTitlesChange({ preferEnding })}
                    />
                  </div>
                </section>
              )}
            </div>
            <span aria-hidden="true" className="top-bar-divider" />
            <div
              className="active-file"
              title={activeSlide
                ? `${activeSlide.name} · Source ${formatDimensions(activeSlide.width, activeSlide.height)} · Display ${displayResolution ? formatDimensions(displayResolution.width, displayResolution.height) : '—'}`
                : undefined}
            >
              <span className="active-file-name">{activeSlide?.name ?? 'Untitled presentation'}</span>
              <span aria-hidden="true" className="active-file-divider active-file-source-divider" />
              {activeSlide ? (
                <>
                  <span className="active-file-meta active-file-meta-source">
                    <span className="active-file-meta-label">Source</span>
                    {formatDimensions(activeSlide.width, activeSlide.height)}
                  </span>
                  <span aria-hidden="true" className="active-file-divider active-file-display-divider" />
                  <span className="active-file-meta active-file-meta-display">
                    <span className="active-file-meta-label">Display</span>
                    {displayResolution ? formatDimensions(displayResolution.width, displayResolution.height) : '—'}
                  </span>
                </>
              ) : (
                <span className="active-file-meta">No media loaded</span>
              )}
            </div>
          </div>
        )}

        {!isHome && <div
          aria-hidden={!isChromeVisible}
          aria-label="View controls"
          className="view-controls"
          inert={!isChromeVisible ? true : undefined}
        >
          <div
            aria-hidden={mode !== 'canvas'}
            className="canvas-options"
            data-visible={mode === 'canvas'}
            inert={mode !== 'canvas' ? true : undefined}
            role="group"
            aria-label="Canvas options"
          >
            {viewportEnabled && (
              <ViewportMarkerField
                marker={viewportMarker}
                onChange={onViewportMarkerChange}
                viewportHeight={viewport.height}
              />
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
              <span aria-hidden="true" className="toggle-track">
                <span className="toggle-thumb" />
              </span>
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

          <div className="mode-switcher" role="group" aria-label="View mode">
            {MODE_OPTIONS.map((option) => (
              <button
                className="mode-button"
                data-active={mode === option.id}
                key={option.id}
                onClick={() => onModeChange(option.id)}
                title={`${option.label} · ${option.shortcut}`}
                type="button"
                aria-pressed={mode === option.id}
              >
                <Icon name={option.icon} size={16} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>}

        {!isHome && <div className="top-actions">
          <button
            className="icon-button persistent-action publishing-account-button"
            data-active={publishingStatus?.signedIn}
            onClick={onPublishingAccount}
            title={publishingStatus?.signedIn ? `Desktop account · ${publishingStatus.email}` : 'Sign in for publishing'}
            type="button"
          >
            <Icon name="user" size={17} />
            <span className="sr-only">Desktop publishing account</span>
          </button>
          <button className="icon-button persistent-action" onClick={onPublish} title="Publish private web link" type="button">
            <Icon name="upload" size={17} />
            <span className="sr-only">Publish private web link</span>
          </button>
          <button
            aria-pressed={isChromeVisible}
            className="icon-button persistent-action"
            onClick={onToggleChrome}
            title={`${isChromeVisible ? 'Hide' : 'Show'} interface · H`}
            type="button"
          >
            <Icon name={isChromeVisible ? 'eye' : 'eye-off'} size={17} />
            <span className="sr-only">{isChromeVisible ? 'Hide' : 'Show'} interface</span>
          </button>
          <button className="icon-button persistent-action" onClick={onGoHome} title="Back to presentations" type="button">
            <Icon name="close" size={16} />
            <span className="sr-only">Back to presentations</span>
          </button>
        </div>}
      </div>
    </header>
  )
}

interface ViewportMarkerFieldProps {
  marker: number | null
  viewportHeight: number
  onChange: (marker: number | null) => void
}

function ViewportMarkerField({ marker, viewportHeight, onChange }: ViewportMarkerFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(marker?.toString() ?? '')
  const invalid = draft !== '' && (Number(draft) <= 0 || Number(draft) >= viewportHeight)

  useEffect(() => {
    setDraft(marker?.toString() ?? '')
  }, [marker])

  return (
    <label className="topbar-viewport-marker" data-invalid={invalid}>
      <span>Set fold</span>
      <input
        aria-invalid={invalid}
        aria-label="Set fold in pixels"
        inputMode="numeric"
        maxLength={4}
        onBlur={() => {
          if (invalid) setDraft(marker?.toString() ?? '')
        }}
        onChange={(event) => {
          const value = event.target.value.replace(/\D/g, '').slice(0, 4)
          setDraft(value)
          if (!value) {
            onChange(null)
            return
          }
          const nextMarker = Number(value)
          if (nextMarker > 0 && nextMarker < viewportHeight) onChange(nextMarker)
        }}
        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        value={draft}
      />
      <span>px</span>
    </label>
  )
}
