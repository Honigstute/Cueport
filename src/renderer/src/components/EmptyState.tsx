import { Icon } from './Icon'

interface EmptyStateProps {
  isImporting: boolean
  onChooseImages: () => void
}

export function EmptyState({ isImporting, onChooseImages }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-import">
        <div className="empty-drop-zone">
          <span className="empty-drop-icon"><Icon name={isImporting ? 'spark' : 'upload'} size={20} /></span>
          <strong>{isImporting ? 'Reading images…' : 'Drop images to begin'}</strong>
          <small>JPEG, PNG or WebP · multiple files supported</small>
        </div>
        <button className="empty-primary" disabled={isImporting} onClick={onChooseImages} type="button">
          {isImporting ? 'Reading images…' : 'Choose images'}
        </button>
      </div>
    </div>
  )
}
