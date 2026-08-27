import { Icon } from './Icon'

interface EmptyStateProps {
  isImporting: boolean
  onChooseMedia: () => void
}

export function EmptyState({ isImporting, onChooseMedia }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-import">
        <div className="empty-drop-zone">
          <span className="empty-drop-icon"><Icon name={isImporting ? 'spark' : 'upload'} size={20} /></span>
          <strong>{isImporting ? 'Reading media…' : 'Drop media to begin'}</strong>
          <small>JPEG, PNG, WebP or MP4 · multiple files supported</small>
        </div>
        <button className="empty-primary" disabled={isImporting} onClick={onChooseMedia} type="button">
          {isImporting ? 'Reading media…' : 'Choose media'}
        </button>
      </div>
    </div>
  )
}
