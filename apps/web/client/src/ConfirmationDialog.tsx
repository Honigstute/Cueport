import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../../../../src/renderer/src/components/Icon'
import { trapDialogFocus } from './dialogFocus'

interface ConfirmationDialogProps {
  confirmLabel: string
  description: string
  errorMessage: string
  eyebrow?: string
  icon?: IconName
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: string
  tone?: 'danger' | 'primary'
}

/**
 * Shared Cueport confirmation surface for destructive and access-changing work.
 * Keeping async, focus, and dismissal behavior here prevents individual actions
 * from falling back to inconsistent browser-native dialogs.
 */
export function ConfirmationDialog({
  confirmLabel,
  description,
  errorMessage,
  eyebrow = 'Confirm action',
  icon = 'remove',
  onClose,
  onConfirm,
  title,
  tone = 'danger'
}: ConfirmationDialogProps): React.JSX.Element {
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const closeTimerRef = useRef<number | null>(null)
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(false)
  const visibleRef = useRef(false)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  onCloseRef.current = onClose

  const close = useCallback((): void => {
    if (busyRef.current || !visibleRef.current) return
    visibleRef.current = false
    setVisible(false)
    closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), 150)
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      visibleRef.current = true
      setVisible(true)
      cancelRef.current?.focus()
    })
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', closeOnEscape)
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
      const returnTarget = returnFocusRef.current
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus()
      })
    }
  }, [close])

  const submitConfirmation = async (): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      busyRef.current = false
      setBusy(false)
      visibleRef.current = false
      setVisible(false)
      closeTimerRef.current = window.setTimeout(() => onCloseRef.current(), 150)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorMessage)
      busyRef.current = false
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop confirmation-backdrop"
      data-open={visible}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirmation-dialog"
        onKeyDown={trapDialogFocus}
        role="alertdialog"
      >
        <div className="confirmation-heading">
          <span className={`confirmation-icon confirmation-icon-${tone}`}><Icon name={icon} size={18} /></span>
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
        </div>
        <p className="confirmation-description" id={descriptionId}>{description}</p>
        {error && <p className="web-error confirmation-error" role="alert">{error}</p>}
        <footer className="confirmation-actions">
          <button className="confirmation-cancel" disabled={busy} onClick={close} ref={cancelRef} type="button">Cancel</button>
          <button className={`confirmation-submit confirmation-submit-${tone}`} disabled={busy} onClick={() => void submitConfirmation()} type="button">
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  )
}
