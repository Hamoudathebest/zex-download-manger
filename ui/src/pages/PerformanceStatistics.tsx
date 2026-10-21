import { Card, PageHeader, StatCard } from '../components/ui'
import type { PageProps } from './types'

export default function PerformanceStatistics({ items, preview }: PageProps) {
  // No chart is drawn from invented data. When disconnected, every figure is "—".
  // In preview mode, only counts of the labelled preview rows are shown — never speeds.
  const knownSpeeds = items.map((d) => d.speedBytesPerSec).filter((v): v is number => v !== null)
  return (
    <div>
      <PageHeader title="Performance Statistics" description="Throughput and history charts appear only from real engine measurements. Nothing here is simulated." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Peak speed (engine-reported)" value={knownSpeeds.length ? `${Math.max(...knownSpeeds)} B/s` : '—'} note="— means no engine measurement available" />
        <StatCard label="Average speed (engine-reported)" value="—" note="Computed only from engine samples, when present" />
        <StatCard label="Total downloaded (engine-reported)" value={preview ? 'Preview rows only — see tables' : '—'} note="— means no engine measurement available" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Speed over time">
          <p>No speed-over-time chart is drawn in Phase 1: there are no engine samples to plot. Drawing a smooth curve here would be fabricated activity.</p>
          <div aria-hidden="true" className="mt-3 flex h-32 items-center justify-center rounded bg-gray-100 text-xs text-gray-500 dark:bg-gray-800">No data — chart placeholder, not a measurement</div>
        </Card>
        <Card title="Downloads by status">
          <ul className="list-disc pl-5">
            {['active', 'paused', 'queued', 'completed', 'failed'].map((s) => (
              <li key={s}>{s}: {preview ? items.filter((d) => d.status === s).length : '—'}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">Counts in preview mode describe the labelled preview rows only.</p>
        </Card>
      </div>
    </div>
  )
}
