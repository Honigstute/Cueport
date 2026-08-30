/**
 * Copy text in both browsers and Electron.
 *
 * The Clipboard API can be unavailable or denied even on HTTPS, so copying a
 * client link must retain the older selection-based fallback. Callers surface
 * the rejected promise instead of silently pretending that copying worked.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) throw new Error('There is no link to copy.')

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Browser permission policies can reject this path. Continue below.
    }
  }

  if (typeof document === 'undefined' || !document.body || typeof document.execCommand !== 'function') {
    throw new Error('Copying is unavailable. Select the link and copy it manually.')
  }

  const input = document.createElement('textarea')
  input.value = text
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  document.body.appendChild(input)
  input.select()

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Copying is unavailable. Select the link and copy it manually.')
    }
  } finally {
    input.remove()
  }
}
