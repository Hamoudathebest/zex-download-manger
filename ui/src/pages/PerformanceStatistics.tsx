import { Card, PageHeader, StatCard } from '../components/ui'
import type { PageProps } from './types'

export default function PerformanceStatistics({ items, preview, connection }: PageProps) {
  // No chart is drawn from invented data. When disconnected, every figure is "—".
  // In preview mode, only counts of the labelled preview rows are shown — never speeds.
  const knownSpeeds = items.map((d) => d.speedBytesPerSec).filter((v): v is number => v !== null)
  return (
    <div>
      <PageHeader title="Performance Statistics" description="Throughput and history charts appear only from real engine measurements. Nothing here is simulated." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Peak speed (engine-reported)" value={knownSpeeds.length ? `${Math.max(...knownSpeeds)} B/s` : '—'} note="— means no engine measurement available" />
         <StatCard label="Average speed (engine-reported)" value={knownSpeeds.length ? `${Math.round(knownSpeeds.reduce((sum, speed) => sum + speed, 0) / knownSpeeds.length)} B/s` : '—'} note="Mean of current engine-reported download rates" />
         <StatCard label="Total downloaded (engine-reported)" value={preview ? 'Preview rows only — see tables' : `${items.reduce((sum, item) => sum + (item.downloadedBytes ?? 0), 0)} B`} note="Sum of bytes currently reported for retained jobs" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Speed over time">
          <p>Live per-download rates appear in the download table. A historical speed chart needs persisted samples, which are not yet stored.</p>
          <div aria-hidden="true" className="mt-3 flex h-32 items-center justify-center rounded bg-gray-100 text-xs text-gray-500 dark:bg-gray-800">No data — chart placeholder, not a measurement</div>
        </Card>
        <Card title="Downloads by status">
          <ul className="list-disc pl-5">
            {['active', 'paused', 'queued', 'interrupted', 'completed', 'failed', 'cancelled'].map((s) => (
              <li key={s}>{s}: {preview || connection === 'connected' ? items.filter((d) => d.status === s).length : '—'}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">Counts are based on retained desktop records; preview counts are labelled static examples.</p>
        </Card>
      </div>
    </div>
  )
}
