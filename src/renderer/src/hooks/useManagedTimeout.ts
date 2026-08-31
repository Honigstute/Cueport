import { useCallback, useEffect, useRef } from 'react'

interface ManagedTimeout {
  cancel: () => void
  schedule: (callback: () => void, delayMs: number) => void
}

/**
 * Owns one replaceable UI timeout and always clears it on unmount. This keeps
 * short-lived feedback such as “Copied” predictable when actions happen in
 * quick succession or a dialog closes before its timer finishes.
 */
export function useManagedTimeout(): ManagedTimeout {
  const timeoutRef = useRef<number | null>(null)

  const cancel = useCallback((): void => {
    if (timeoutRef.current === null) return
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const schedule = useCallback((callback: () => void, delayMs: number): void => {
    cancel()
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null
      callback()
    }, delayMs)
  }, [cancel])

  useEffect(() => cancel, [cancel])

  return { cancel, schedule }
}
