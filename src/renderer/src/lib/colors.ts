const HEX_COLOR = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim())
}

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim()
  if (!isHexColor(trimmed)) return null

  const raw = trimmed.replace(/^#/, '')
  const expanded = raw.length === 3 ? raw.split('').map((character) => character.repeat(2)).join('') : raw
  return `#${expanded.toUpperCase()}`
}

interface RgbColor {
  red: number
  green: number
  blue: number
}

function hexToRgb(value: string): RgbColor | null {
  const normalized = normalizeHex(value)
  if (!normalized) return null

  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16)
  }
}

function relativeLuminance(color: RgbColor): number {
  const linearize = (channel: number): number => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }

  return (
    linearize(color.red) * 0.2126 +
    linearize(color.green) * 0.7152 +
    linearize(color.blue) * 0.0722
  )
}

/** Choose the Cueport palette ink with the strongest contrast. */
export function getReadableInk(value: string): '#1D1D1D' | '#E8E8E8' {
  const background = hexToRgb(value)
  if (!background) return '#1D1D1D'

  const dark = hexToRgb('#1D1D1D')!
  const light = hexToRgb('#E8E8E8')!
  const backgroundLuminance = relativeLuminance(background)
  const contrast = (foreground: RgbColor): number => {
    const foregroundLuminance = relativeLuminance(foreground)
    const lighter = Math.max(backgroundLuminance, foregroundLuminance)
    const darker = Math.min(backgroundLuminance, foregroundLuminance)
    return (lighter + 0.05) / (darker + 0.05)
  }

  return contrast(light) >= contrast(dark) ? '#E8E8E8' : '#1D1D1D'
}
