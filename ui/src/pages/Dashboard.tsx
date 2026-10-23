import { ConnectionBanner, DownloadTable, Icon, StatCard } from '../components/ui'
import { formatBytes, formatSpeed } from '../data/downloads'
import type { PageProps } from './types'

export default function Dashboard({ items, connection, error, preview, onTogglePreview, onOpenDetails }: PageProps) {
  const active = items.filter((item) => item.status === 'active')
  const completed = items.filter((item) => item.status === 'completed')
  const queued = items.filter((item) => item.status === 'queued')
  const measured = active.filter((item) => item.speedBytesPerSec !== null)
  const speed = measured.length
    ? formatSpeed(measured.reduce((total, item) => total + (item.speedBytesPerSec ?? 0), 0))
    : '—'
  const recent = [...items].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 6)

  return (
    <div className="dashboard-page">
      <ConnectionBanner connection={connection} error={error} preview={preview} onTogglePreview={onTogglePreview} />
      <div className="stats-grid">
        <StatCard label="Downloading" value={preview || connection === 'connected' ? String(active.length) : '—'} note="Live engine transfers" icon="download" tone="cyan" />
        <StatCard label="Total speed" value={!preview && measured.length ? speed : '—'} note="Sum of current engine samples" icon="zap" tone="primary" />
        <StatCard label="Completed" value={preview || connection === 'connected' ? String(completed.length) : '—'} note={completed.length ? `${formatBytes(completed.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0))} transferred` : 'Finished files'} icon="check" tone="green" />
        <StatCard label="In queue" value={preview || connection === 'connected' ? String(queued.length) : '—'} note="Waiting for an available slot" icon="list" tone="amber" />
      </div>

      <section className="dashboard-main-grid">
        <div className="dashboard-recent">
          <div className="section-heading section-heading-tight">
            <div><h2>Recent downloads</h2><p>Latest items reported by the engine</p></div>
            <a className="section-link" href="#/all">View all <Icon name="chevron-right" size={14} /></a>
          </div>
           <DownloadTable items={recent} preview={preview} onOpenDetails={onOpenDetails} showViewToggle={false} initialView="list" />
        </div>
        <aside className="dashboard-side">
          <section className="side-panel">
            <div className="side-panel-heading"><span className="side-panel-icon"><Icon name="activity" size={17} /></span><div><h2>Network activity</h2><p>Measured by the transfer engine</p></div></div>
            {measured.length ? (
              <div className="network-total"><strong>{speed}</strong><span>current throughput</span></div>
            ) : (
              <div className="network-empty"><span className="network-pulse" /><span>No active speed sample yet</span></div>
            )}
            <div className="network-legend"><span><i className="legend-download" />Download</span><span>{measured.length ? `${measured.length} active` : 'Waiting for transfer'}</span></div>
          </section>
          <section className="side-panel activity-panel">
            <div className="side-panel-heading"><span className="side-panel-icon side-icon-cyan"><Icon name="clock" size={17} /></span><div><h2>Activity</h2><p>Most recent status changes</p></div></div>
            {recent.length ? recent.slice(0, 4).map((item) => (
              <button type="button" className="activity-item" key={item.id} onClick={() => onOpenDetails?.(item)}>
                <span className={`activity-marker activity-${item.status}`} />
                <span className="activity-copy"><strong>{item.name}</strong><small>{item.status === 'completed' ? 'Download completed' : item.status === 'active' ? 'Transfer in progress' : `${item.status[0].toUpperCase()}${item.status.slice(1)}`}</small></span>
                <Icon name="chevron-right" size={14} />
              </button>
            )) : <div className="activity-empty">Activity will appear when downloads are added.</div>}
          </section>
        </aside>
      </section>
    </div>
  )
}
