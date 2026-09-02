const PRIVATE_PRESENTATION_RETURN_KEY = 'cueport:private-presentation-return'
const PRIVATE_PRESENTATION_PATH = /^\/p\/[A-Za-z0-9_-]+$/

interface ReturnPathStorage {
  getItem: (key: string) => string | null
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
}

/**
 * Only private Cueport routes may be used after authentication. Keeping this
 * allow-list local prevents a stored value from becoming an open redirect.
 */
export function normalizePrivatePresentationReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || !PRIVATE_PRESENTATION_PATH.test(value)) return null
  return value
}

export function rememberPrivatePresentationReturnPath(storage: ReturnPathStorage, pathname: string): void {
  const safePath = normalizePrivatePresentationReturnPath(pathname)
  if (!safePath) return

  try {
    storage.setItem(PRIVATE_PRESENTATION_RETURN_KEY, safePath)
  } catch {
    // Login still works when session storage is blocked by browser privacy settings.
  }
}

export function consumePrivatePresentationReturnPath(storage: ReturnPathStorage): string | null {
  try {
    const safePath = normalizePrivatePresentationReturnPath(storage.getItem(PRIVATE_PRESENTATION_RETURN_KEY))
    storage.removeItem(PRIVATE_PRESENTATION_RETURN_KEY)
    return safePath
  } catch {
    return null
  }
}
