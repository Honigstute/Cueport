import { useEffect, useRef, useState } from 'react'
import { normalizeHex } from '../lib/colors'
import { DEFAULT_CANVAS_BACKGROUND } from '../state/presentationReducer'
import { CANVAS_FRAMES, type BrandSettings, type CanvasFrame, type LogoPosition, type PhoneBrowserBarsSettings, type ViewportCategory, type ViewportSize } from '../types'
import { Icon, type IconName } from './Icon'
import { SettingToggle } from './SettingToggle'

interface InspectorProps {
  viewportEnabled: boolean
  canvasStartAtTop: boolean
  canvasRoundedCorners: boolean
  canvasImageGlow: boolean
  referenceImageShadow: boolean
  canvasFrame: CanvasFrame
  programBarColor: string
  phoneBrowserBars: PhoneBrowserBarsSettings
  background: string
  viewport: ViewportSize
  brand: BrandSettings
  onBackgroundChange: (background: string) => void
  onCanvasStartAtTopChange: (value: boolean) => void
  onCanvasRoundedCornersChange: (value: boolean) => void
  onCanvasImageGlowChange: (value: boolean) => void
  onReferenceImageShadowChange: (value: boolean) => void
  onCanvasFrameChange: (frame: CanvasFrame) => void
  onProgramBarColorChange: (color: string) => void
  onPhoneBrowserBarsChange: (patch: Partial<PhoneBrowserBarsSettings>) => void
  onViewportCategoryChange: (category: ViewportCategory, viewport: ViewportSize) => void
  onViewportChange: (viewport: ViewportSize) => void
  onLogoFile: (file: File) => void
  onRemoveLogo: () => void
  onPatchBrand: (patch: Partial<Omit<BrandSettings, 'logoUrl' | 'logoName'>>) => void
}

const BACKGROUNDS = ['#101318', '#272C34', '#555C66', '#D5D8DE', DEFAULT_CANVAS_BACKGROUND]
const VIEWPORT_CATEGORIES = ['Desktop', 'Laptop', 'Mobile'] as const

interface ViewportPreset extends ViewportSize {
  category: ViewportCategory
}

/**
 * A deliberately small set of useful presentation targets. Phone values are
 * browser viewport pixels rather than physical display pixels, so imported
 * website captures match the frame without extra scaling.
 */
const VIEWPORT_PRESETS: Record<ViewportCategory, ViewportPreset[]> = {
  Desktop: [
    { category: 'Desktop', label: 'Full HD', width: 1920, height: 1080 },
    { category: 'Desktop', label: 'QHD', width: 2560, height: 1440 },
    { category: 'Desktop', label: '4K UHD', width: 3840, height: 2160 },
    { category: 'Desktop', label: 'Ultrawide', width: 3440, height: 1440 }
  ],
  Laptop: [
    { category: 'Laptop', label: 'Standard laptop', width: 1366, height: 768 },
    { category: 'Laptop', label: 'MacBook-style', width: 1440, height: 900 },
    { category: 'Laptop', label: 'Modern laptop', width: 1536, height: 864 },
    { category: 'Laptop', label: 'WUXGA laptop', width: 1920, height: 1200 }
  ],
  Mobile: [
    { category: 'Mobile', label: 'iPhone 17 / 17 Pro', width: 402, height: 874 },
    { category: 'Mobile', label: 'iPhone 17 Pro Max', width: 440, height: 956 },
    { category: 'Mobile', label: 'iPhone 15 / 16', width: 393, height: 852 },
    { category: 'Mobile', label: 'iPhone SE', width: 375, height: 667 },
    { category: 'Mobile', label: 'Galaxy S26', width: 360, height: 780 },
    { category: 'Mobile', label: 'Galaxy S26 Ultra', width: 384, height: 832 }
  ]
}

const getViewportKey = ({ width, height }: Pick<ViewportSize, 'width' | 'height'>): string => `${width}x${height}`

function findViewportPreset(viewport: ViewportSize): ViewportPreset | undefined {
  return VIEWPORT_CATEGORIES
    .flatMap((category) => VIEWPORT_PRESETS[category])
    .find((preset) => preset.width === viewport.width && preset.height === viewport.height)
}

function inferViewportCategory(viewport: ViewportSize): ViewportCategory {
  return findViewportPreset(viewport)?.category ?? (viewport.width <= 600 ? 'Mobile' : viewport.width < 1920 ? 'Laptop' : 'Desktop')
}
const LOGO_POSITIONS: LogoPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const CANVAS_FRAME_LABELS: Record<CanvasFrame, string> = {
  none: 'None',
  mac: 'Mac',
  windows: 'Win',
  phone: 'Phone'
}

interface InspectorDisclosureProps {
  children: React.ReactNode
  icon: IconName
  label: string
  summary?: React.ReactNode
}

/** A shared disclosure row keeps every inspector category visually consistent. */
function InspectorDisclosure({ children, icon, label, summary }: InspectorDisclosureProps): React.JSX.Element {
  return (
    <details className="inspector-disclosure">
      <summary className="inspector-disclosure-trigger">
        <span className="inspector-disclosure-label">
          <Icon name={icon} size={17} />
          <span>{label}</span>
        </span>
        <span className="inspector-disclosure-end">
          {summary && <span className="inspector-disclosure-summary">{summary}</span>}
          <Icon className="inspector-disclosure-chevron" name="chevron-down" size={15} />
        </span>
      </summary>
      <div className="inspector-section">{children}</div>
    </details>
  )
}

export function Inspector({
  viewportEnabled,
  canvasStartAtTop,
  canvasRoundedCorners,
  canvasImageGlow,
  referenceImageShadow,
  canvasFrame,
  programBarColor,
  phoneBrowserBars,
  background,
  viewport,
  brand,
  onBackgroundChange,
  onCanvasStartAtTopChange,
  onCanvasRoundedCornersChange,
  onCanvasImageGlowChange,
  onReferenceImageShadowChange,
  onCanvasFrameChange,
  onProgramBarColorChange,
  onPhoneBrowserBarsChange,
  onViewportCategoryChange,
  onViewportChange,
  onLogoFile,
  onRemoveLogo,
  onPatchBrand
}: InspectorProps): React.JSX.Element {
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [customWidth, setCustomWidth] = useState(viewport.width.toString())
  const [customHeight, setCustomHeight] = useState(viewport.height.toString())
  const [viewportError, setViewportError] = useState<string | null>(null)
  const [viewportCategory, setViewportCategory] = useState<ViewportCategory>(() => inferViewportCategory(viewport))

  useEffect(() => {
    setCustomWidth(viewport.width.toString())
    setCustomHeight(viewport.height.toString())
    const preset = findViewportPreset(viewport)
    if (preset) setViewportCategory(preset.category)
  }, [viewport])

  const categoryPresets = VIEWPORT_PRESETS[viewportCategory]
  const selectedPreset = categoryPresets.find((preset) => getViewportKey(preset) === getViewportKey(viewport))

  const commitCustomViewport = (): void => {
    const width = Number(customWidth)
    const height = Number(customHeight)
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 240 || height < 240 || width > 5120 || height > 5120) {
      setViewportError('Use whole numbers from 240 to 5120.')
      return
    }
    setViewportError(null)
    onViewportChange({ label: 'Custom', width, height })
  }

  return (
    <aside className="inspector" aria-label="Settings">
      {viewportEnabled && (
        <InspectorDisclosure
          icon="viewport"
          label="Viewport"
          summary={`${viewport.width} × ${viewport.height}`}
        >
          <div className="preset-grid">
            {VIEWPORT_CATEGORIES.map((category) => (
              <button
                aria-pressed={viewportCategory === category}
                data-active={viewportCategory === category}
                key={category}
                onClick={() => {
                  setViewportCategory(category)
                  onViewportCategoryChange(category, VIEWPORT_PRESETS[category][0])
                }}
                type="button"
              >
                <span className={`device-shape device-${category.toLowerCase()}`} />
                <span>{category}</span>
              </button>
            ))}
          </div>
          <label className="viewport-preset-select">
            <span className="sr-only">{viewportCategory} resolution</span>
            <select
              onChange={(event) => {
                const preset = categoryPresets.find((candidate) => getViewportKey(candidate) === event.target.value)
                if (preset) onViewportChange(preset)
              }}
              value={selectedPreset ? getViewportKey(selectedPreset) : ''}
            >
              {!selectedPreset && <option value="">Custom — {viewport.width} × {viewport.height}</option>}
              {categoryPresets.map((preset) => (
                <option key={`${preset.category}-${preset.label}`} value={getViewportKey(preset)}>
                  {preset.label} — {preset.width} × {preset.height}
                </option>
              ))}
            </select>
            <Icon aria-hidden="true" name="chevron-down" size={15} />
          </label>
          <div className="dimension-inputs">
            <label>
              <span>W</span>
              <input
                inputMode="numeric"
                onChange={(event) => setCustomWidth(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && commitCustomViewport()}
                value={customWidth}
              />
            </label>
            <span>×</span>
            <label>
              <span>H</span>
              <input
                inputMode="numeric"
                onChange={(event) => setCustomHeight(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && commitCustomViewport()}
                value={customHeight}
              />
            </label>
            <button onClick={commitCustomViewport} title="Apply custom viewport" type="button">
              <Icon name="check" size={14} />
            </button>
          </div>
          {viewportError && <p className="field-error">{viewportError}</p>}
        </InspectorDisclosure>
      )}

      <InspectorDisclosure icon="palette" label="Canvas style">
        <div className="inspector-content-toolbar">
          <button className="section-reset" onClick={() => onBackgroundChange(DEFAULT_CANVAS_BACKGROUND)} type="button">Reset</button>
        </div>
        <div className="color-swatches" role="group" aria-label="Canvas color presets">
          {BACKGROUNDS.map((color) => (
            <button
              aria-label={`Use ${color}`}
              aria-pressed={background.toUpperCase() === color}
              data-active={background.toUpperCase() === color}
              key={color}
              onClick={() => onBackgroundChange(color)}
              style={{ '--swatch': color } as React.CSSProperties}
              type="button"
            >
              {background.toUpperCase() === color && <Icon name="check" size={12} />}
            </button>
          ))}
        </div>
        <HexColorControl color={background} label="Canvas" onChange={onBackgroundChange} />

        <div className="canvas-display-options">
          <SettingToggle
            checked={canvasStartAtTop}
            description="Remove the upper canvas gap"
            label="Start at top"
            onChange={onCanvasStartAtTopChange}
          />

          <SettingToggle
            checked={canvasRoundedCorners}
            description="Match the canvas to the interface"
            label="Rounded corners"
            onChange={onCanvasRoundedCornersChange}
          />

          <SettingToggle
            checked={canvasImageGlow}
            description="Create a soft glow from the image colors"
            label="Image glow"
            onChange={onCanvasImageGlowChange}
          />

          <SettingToggle
            checked={referenceImageShadow}
            description="Add depth behind temporary reference overlays"
            label="Reference shadow"
            onChange={onReferenceImageShadowChange}
          />
        </div>
      </InspectorDisclosure>

      <InspectorDisclosure icon="window" label="Window frame">
        <div className="canvas-frame-control">
          <div className="canvas-frame-options" role="group" aria-label="Window frame">
            {CANVAS_FRAMES.map((frame) => (
              <button
                aria-pressed={canvasFrame === frame}
                data-active={canvasFrame === frame}
                key={frame}
                onClick={() => onCanvasFrameChange(frame)}
                type="button"
              >
                {CANVAS_FRAME_LABELS[frame]}
              </button>
            ))}
          </div>
          {canvasFrame !== 'none' && (
            <HexColorControl color={programBarColor} label="Program bar" onChange={onProgramBarColorChange} />
          )}
          {canvasFrame === 'phone' && (
            <div className="phone-browser-controls">
              <SettingToggle
                checked={phoneBrowserBars.enabled}
                description="Reserve space for mobile browser controls"
                label="Browser bars"
                onChange={(enabled) => onPhoneBrowserBarsChange({ enabled })}
              />
              {phoneBrowserBars.enabled && (
                <HexColorControl
                  color={phoneBrowserBars.color}
                  label="Browser bars"
                  onChange={(color) => onPhoneBrowserBarsChange({ color })}
                />
              )}
            </div>
          )}
        </div>
      </InspectorDisclosure>

      <InspectorDisclosure icon="image" label="Client mark">
        {brand.logoUrl && (
          <div className="inspector-content-toolbar">
            <button className="section-reset" onClick={onRemoveLogo} type="button">Remove</button>
          </div>
        )}

        <input
          accept=".jpg,.jpeg,.png,.webp,.svg,image/jpeg,image/png,image/webp,image/svg+xml"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onLogoFile(file)
            event.target.value = ''
          }}
          ref={logoInputRef}
          type="file"
        />

        {!brand.logoUrl ? (
          <button className="logo-drop" onClick={() => logoInputRef.current?.click()} type="button">
            <span><Icon name="image" size={18} /></span>
            <strong>Add client logo</strong>
            <small>PNG or SVG works best</small>
          </button>
        ) : (
          <>
            <button className="logo-preview" onClick={() => logoInputRef.current?.click()} type="button">
              <span><img alt="" src={brand.logoUrl} /></span>
              <span>
                <strong>{brand.logoName}</strong>
                <small>Click to replace</small>
              </span>
            </button>

            <SettingToggle
              checked={brand.showOnCanvas}
              description="The logo remains the saved presentation thumbnail"
              label="Show on canvas"
              onChange={(showOnCanvas) => onPatchBrand({ showOnCanvas })}
            />

            <div className="position-control">
              <span>Position</span>
              <div className="position-grid" role="group" aria-label="Logo position">
                {LOGO_POSITIONS.map((position) => (
                  <button
                    aria-label={position.replace('-', ' ')}
                    aria-pressed={brand.position === position}
                    data-active={brand.position === position}
                    key={position}
                    onClick={() => onPatchBrand({ position })}
                    type="button"
                  ><i /></button>
                ))}
              </div>
            </div>

            <RangeControl
              label="Size"
              max={240}
              min={48}
              onChange={(width) => onPatchBrand({ width })}
              suffix="px"
              value={brand.width}
            />
            <RangeControl
              label="Opacity"
              max={100}
              min={20}
              onChange={(opacity) => onPatchBrand({ opacity: opacity / 100 })}
              suffix="%"
              value={Math.round(brand.opacity * 100)}
            />
            <RangeControl
              label="Edge"
              max={80}
              min={8}
              onChange={(margin) => onPatchBrand({ margin })}
              suffix="px"
              value={brand.margin}
            />
          </>
        )}
      </InspectorDisclosure>

    </aside>
  )
}

interface HexColorControlProps {
  color: string
  label: string
  onChange: (color: string) => void
}

/** Shared color input keeps canvas and program-bar editing identical. */
function HexColorControl({ color, label, onChange }: HexColorControlProps): React.JSX.Element {
  const [draft, setDraft] = useState(color.replace(/^#/, '').toLowerCase())

  useEffect(() => setDraft(color.replace(/^#/, '').toLowerCase()), [color])

  const commit = (): void => {
    const normalized = normalizeHex(draft)
    if (normalized) onChange(normalized)
    else setDraft(color.replace(/^#/, '').toLowerCase())
  }

  return (
    <div className="custom-color-controls">
      <label
        className="custom-color-swatch"
        style={{ '--swatch': color } as React.CSSProperties}
        title={`Choose a custom ${label.toLowerCase()} color`}
      >
        <input
          aria-label={`Choose a custom ${label.toLowerCase()} color`}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          type="color"
          value={color}
        />
      </label>
      <label className="hex-color-field">
        <span aria-hidden="true">#</span>
        <input
          aria-label={`${label} hex color`}
          autoComplete="off"
          maxLength={6}
          onBlur={commit}
          onChange={(event) => {
            setDraft(event.target.value
              .replace(/^#/, '')
              .replace(/[^0-9a-f]/gi, '')
              .slice(0, 6)
              .toLowerCase())
          }}
          onKeyDown={(event) => event.key === 'Enter' && commit()}
          pattern="[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}"
          spellCheck={false}
          value={draft}
        />
      </label>
    </div>
  )
}

interface RangeControlProps {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  onChange: (value: number) => void
}

function RangeControl({ label, value, min, max, suffix, onChange }: RangeControlProps): React.JSX.Element {
  return (
    <label className="range-control">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--range-progress': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        type="range"
        value={value}
      />
      <output>{value}{suffix}</output>
    </label>
  )
}
