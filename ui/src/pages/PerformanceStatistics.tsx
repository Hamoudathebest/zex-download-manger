import { Card, Icon, PageHeader, StatCard } from '../components/ui'
import { formatBytes, formatSpeed } from '../data/downloads'
import type { PageProps } from './types'

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--app-cyan)',
  queued: 'var(--app-primary)',
  paused: 'var(--app-warning)',
  interrupted: '#f97316',
  completed: 'var(--app-success)',
  failed: 'var(--app-error)',
  cancelled: 'var(--app-subtle)',
}

export default function PerformanceStatistics({ items, preview, connection }: PageProps) {
  const samples = items.filter((item) => item.status === 'active').map((item) => item.speedBytesPerSec).filter((value): value is number => value !== null)
  const statuses = ['active', 'queued', 'paused', 'interrupted', 'completed', 'failed', 'cancelled']
    .map((status) => ({ status, count: items.filter((item) => item.status === status).length }))
    .filter((item) => item.count > 0)
  const totalRecords = statuses.reduce((sum, item) => sum + item.count, 0)
  const totalBytes = items.reduce((sum, item) => sum + (item.downloadedBytes ?? 0), 0)
  const live = !preview && connection === 'connected'

  return (
    <div className="stats-page">
      <PageHeader eyebrow="INSIGHTS" title="Performance" description="A summary of measurements currently retained by the engine." />
      <div className="stats-grid">
        <StatCard label="Peak observed speed" value={live && samples.length ? formatSpeed(Math.max(...samples)) : '—'} note="Highest current active-download sample" icon="zap" tone="cyan" />
        <StatCard label="Average observed speed" value={live && samples.length ? formatSpeed(Math.round(samples.reduce((sum, speed) => sum + speed, 0) / samples.length)) : '—'} note="Mean of current active-download samples" icon="activity" tone="primary" />
        <StatCard label="Bytes recorded" value={live ? formatBytes(totalBytes) : '—'} note="Sum across retained download records" icon="archive" tone="green" />
        <StatCard label="Download records" value={live ? String(items.length) : '—'} note="Current local history and active jobs" icon="history" tone="amber" />
      </div>
      <div className="analytics-grid">
        <Card title="Download status" icon="activity">
          {totalRecords ? <>
            <div className="status-distribution" role="img" aria-label="Distribution of retained download records by status">
              {statuses.map((item) => <span key={item.status} title={`${item.status}: ${item.count}`} style={{ width: `${item.count / totalRecords * 100}%`, background: STATUS_COLORS[item.status] }} />)}
            </div>
            <div className="status-legend">{statuses.map((item) => <span key={item.status}><i style={{ background: STATUS_COLORS[item.status] }} />{item.status}<strong>{item.count}</strong></span>)}</div>
          </> : <p className="analytics-empty">Status totals appear when the engine reports download records.</p>}
        </Card>
        <Card title="Speed history" icon="activity">
          <div className="chart-empty"><span className="chart-empty-icon"><Icon name="activity" size={20} /></span><strong>History samples are not stored yet</strong><p>Current speed and ETA are shown on each active download. A time-series chart will appear when ZEX retains timestamped samples.</p></div>
        </Card>
      </div>
    </div>
  )
}
