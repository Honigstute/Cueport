import type { ChromeMode } from '../types'

/** A single H press changes only the side panels. */
export function toggleSidePanels(mode: ChromeMode): ChromeMode {
  return mode === 'all' || mode === 'sequence' || mode === 'settings' ? 'top' : 'all'
}

/** The eye and a rapid double-H always operate the complete interface. */
export function toggleCompleteInterface(mode: ChromeMode): ChromeMode {
  return mode === 'hidden' ? 'all' : 'hidden'
}
