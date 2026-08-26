import type { ToastMessage } from '../types'
import { Icon } from './Icon'

interface ToastProps {
  toast: ToastMessage
  onDismiss: () => void
}

export function Toast({ toast, onDismiss }: ToastProps): React.JSX.Element {
  return (
    <div className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <span className="toast-icon">
        <Icon name={toast.tone === 'error' ? 'close' : toast.tone === 'success' ? 'check' : 'spark'} size={14} />
      </span>
      <span>{toast.text}</span>
      <button onClick={onDismiss} type="button">
        <Icon name="close" size={13} />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  )
}
