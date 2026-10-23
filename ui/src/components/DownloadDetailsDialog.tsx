import type { DownloadItem } from '../data/downloads'
import { formatBytes, formatDuration, formatSpeed } from '../data/downloads'
import { Button, Icon, IconButton, ProgressBar, StatusBadge } from './ui'

export default function DownloadDetailsDialog({
  item,
  onClose,
  onResume,
  onPause,
  onCancel,
  onOpenFile,
  onOpenFolder,
}: {
  item: DownloadItem | null
  onClose: () => void
  onResume?: (id: string) => Promise<void>
  onPause?: (id: string) => Promise<void>
  onCancel?: (id: string) => Promise<void>
  onOpenFile?: (id: string) => Promise<void>
  onOpenFolder?: (id: string) => Promise<void>
}) {
  if (!item) return null
  const percent = item.progressPercent === null ? '—' : `${Math.round(item.progressPercent)}%`
  return (
    <div className="modal-backdrop details-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <aside className="details-panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="download-details-title">
        <header className="details-header">
          <div className="details-title-icon"><Icon name="file" size={20} /></div>
          <div className="details-title-copy"><span className="eyebrow">DOWNLOAD DETAILS</span><h2 id="download-details-title">{item.name}</h2><p>{item.url}</p></div>
          <IconButton icon="close" label="Close details" onClick={onClose} />
        </header>

        <div className="details-scroll">
          <div className="details-status-row"><StatusBadge status={item.status} /><span className="details-destination">{item.destination}</span></div>
          <section className="details-progress-card">
            <div className="details-progress-heading"><span>Download progress</span><strong>{percent}</strong></div>
            <ProgressBar value={item.progressPercent} label={item.name} />
            <div className="details-transferred"><span>{formatBytes(item.downloadedBytes)} downloaded</span><span>of {formatBytes(item.sizeBytes)}</span></div>
          </section>

          <div className="details-metric-grid">
            <section className="details-metric"><span><Icon name="zap" size={15} />Current speed</span><strong>{formatSpeed(item.speedBytesPerSec)}</strong></section>
            <section className="details-metric"><span><Icon name="clock" size={15} />Time remaining</span><strong>{item.status === 'completed' ? 'Complete' : formatDuration(item.etaSeconds)}</strong></section>
            <section className="details-metric"><span><Icon name="archive" size={15} />Category</span><strong className="capitalize">{item.category}</strong></section>
            <section className="details-metric"><span><Icon name="calendar" size={15} />Added</span><strong>{new Date(item.addedAt).toLocaleString()}</strong></section>
          </div>

          <section className="details-section">
            <h3>Source</h3>
            <div className="detail-property"><span>URL</span><a href={item.url} title={item.url}>{item.url}</a></div>
            <div className="detail-property"><span>Host</span><strong>{safeHost(item.url)}</strong></div>
            <div className="detail-property"><span>Destination</span><strong>{item.destination}</strong></div>
          </section>

          {item.error && <section className="details-error"><Icon name="warning" size={17} /><div><strong>Engine message</strong><p>{item.error}</p></div></section>}
          {item.resumable && <p className="resume-note"><Icon name="refresh" size={15} />A matching partial file and validated checkpoint are available to resume.</p>}
          {item.status === 'active' && <p className="details-footnote">Transfer internals are not emitted by the current engine API.</p>}
        </div>

        <footer className="details-footer">
          {item.status === 'active' && onPause && <Button onClick={() => void onPause(item.id)} icon="pause">Pause</Button>}
          {item.resumable && onResume && <Button variant="primary" onClick={() => void onResume(item.id)} icon="play">Resume</Button>}
          {item.status === 'completed' && onOpenFile && <Button onClick={() => void onOpenFile(item.id)} icon="external">Open file</Button>}
          {item.status === 'completed' && onOpenFolder && <Button onClick={() => void onOpenFolder(item.id)} icon="folder">Show in folder</Button>}
          {onCancel && ['active', 'queued', 'paused', 'interrupted', 'failed'].includes(item.status) && <Button variant="danger" onClick={() => void onCancel(item.id)} icon="close">Cancel</Button>}
        </footer>
      </aside>
    </div>
  )
}

function safeHost(url: string) {
  try { return new URL(url).hostname } catch { return 'Unknown host' }
}
