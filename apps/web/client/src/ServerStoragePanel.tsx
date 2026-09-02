import { Icon } from '../../../../src/renderer/src/components/Icon'
import { formatBytes } from './formatBytes'

export interface ServerStorageOverview {
  measuredAt: string
  server: {
    totalBytes: number
    usedBytes: number
    availableBytes: number
    usedPercent: number
  }
  cueport: {
    contentBytes: number
    allocatedBytes: number
    physicalFileCount: number
    presentationCount: number
    assetCount: number
    staleDraftCount: number
    staleDraftBytes: number
  }
}

export function ServerStoragePanel({
  error,
  loading,
  onRefresh,
  storage
}: {
  error: string | null
  loading: boolean
  onRefresh: () => void
  storage: ServerStorageOverview | null
}): React.JSX.Element {
  const usedPercent = Math.max(0, Math.min(100, storage?.server.usedPercent ?? 0))
  const tone = usedPercent >= 90 ? 'critical' : usedPercent >= 80 ? 'warning' : 'normal'

  return (
    <section aria-busy={loading} className="server-storage-panel" data-tone={tone}>
      <div className="server-storage-heading">
        <span className="server-storage-icon"><Icon name="layers" size={17} /></span>
        <div>
          <strong>Server storage</strong>
          <small>{storage
            ? `${formatBytes(storage.server.availableBytes)} available`
            : loading ? 'Measuring storage…' : 'Storage unavailable'}</small>
        </div>
        <button disabled={loading} onClick={onRefresh} title="Refresh storage" type="button">
          <Icon name="refresh" size={15} />
          <span>{loading ? 'Checking…' : 'Refresh'}</span>
        </button>
      </div>

      {storage && (
        <>
          <div className="server-storage-meter" role="progressbar" aria-label="Server disk used" aria-valuemax={100} aria-valuemin={0} aria-valuenow={usedPercent}>
            <span style={{ width: `${usedPercent}%` }} />
          </div>
          <div className="server-storage-stats">
            <span><strong>{usedPercent}%</strong> used · {formatBytes(storage.server.usedBytes)} of {formatBytes(storage.server.totalBytes)}</span>
            <span><strong>{formatBytes(storage.cueport.allocatedBytes)}</strong> Cueport media on disk</span>
            <span>{storage.cueport.presentationCount} presentations · {storage.cueport.physicalFileCount} physical files</span>
            {storage.cueport.staleDraftCount > 0 && (
              <span className="server-storage-warning">
                {storage.cueport.staleDraftCount} unfinished old {storage.cueport.staleDraftCount === 1 ? 'draft' : 'drafts'} · {formatBytes(storage.cueport.staleDraftBytes)}
              </span>
            )}
          </div>
          <p>Server usage includes the website, backups, and system files. Cueport media counts reused files only once.</p>
        </>
      )}
      {error && <p className="server-storage-error" role="alert">{error}</p>}
    </section>
  )
}
