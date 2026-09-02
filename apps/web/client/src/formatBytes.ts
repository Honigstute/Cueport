const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  const value = bytes / 1024 ** unitIndex
  const maximumFractionDigits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value)} ${BYTE_UNITS[unitIndex]}`
}
