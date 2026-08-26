import { useEffect, useRef } from 'react'
import { Icon } from './Icon'

interface HelpDialogProps {
  onClose: () => void
}

const SHORTCUTS = [
  ['⌘ / Ctrl + O', 'Add images'],
  ['←  →', 'Previous / next image'],
  ['F  G', 'Canvas / Fit width'],
  ['⌘ / Ctrl + scroll', 'Adjust canvas zoom'],
  ['⌘ / Ctrl + S', 'Save presentation'],
  ['0', 'Return to actual pixels'],
  ['V', 'Show or hide viewport'],
  ['Home', 'Scroll active image to top'],
  ['H', 'Show or hide the side panels'],
  ['H twice', 'Show or hide the complete interface'],
  ['?', 'Open this reference'],
  ['Esc', 'Hide the interface or close this reference']
]

export function HelpDialog({ onClose }: HelpDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    return () => previousFocus?.focus()
  }, [])

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')
    )
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        aria-labelledby="shortcuts-title"
        aria-modal="true"
        className="help-dialog"
        onKeyDown={trapFocus}
        ref={dialogRef}
        role="dialog"
      >
        <div className="dialog-header">
          <div>
            <span className="eyebrow">Quick reference</span>
            <h2 id="shortcuts-title">Stay in the presentation.</h2>
          </div>
          <button className="icon-button" data-initial-focus onClick={onClose} type="button">
            <Icon name="close" size={17} />
            <span className="sr-only">Close shortcuts</span>
          </button>
        </div>
        <p>Keep the canvas clean, then bring the controls back with H.</p>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys}>
              <dt>{keys}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
