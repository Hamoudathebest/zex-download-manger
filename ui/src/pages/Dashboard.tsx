import { ConnectionBanner, DownloadTable, PageHeader, StatCard } from '../components/ui'
import type { PageProps } from './types'

export default function Dashboard({ items, connection, error, preview, onTogglePreview }: PageProps) {
  const active = items.filter((d) => d.status === 'active' || d.status === 'paused')
  const completed = items.filter((d) => d.status === 'completed')
  return (
    <div>
      <PageHeader title="Dashboard" description="Overview. Live figures appear only when the real engine is connected." />
      <ConnectionBanner connection={connection} error={error} preview={preview} onTogglePreview={onTogglePreview} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active downloads" value={preview || connection === 'connected' ? String(active.length) : '—'} note={preview ? 'Preview count only' : 'Unknown until engine connects'} />
        <StatCard label="Completed" value={preview || connection === 'connected' ? String(completed.length) : '—'} note={preview ? 'Preview count only' : 'Unknown until engine connects'} />
        <StatCard label="Current speed" value="—" note="Never estimated in Phase 1; shown only from engine data" />
        <StatCard label="Queued" value={preview || connection === 'connected' ? String(items.filter((d) => d.status === 'queued').length) : '—'} note={preview ? 'Preview count only' : 'Unknown until engine connects'} />
      </div>
      <h2 className="mt-8 mb-3 text-lg font-semibold text-gray-900 dark:text-white">Recent downloads</h2>
      <DownloadTable items={items} preview={preview} />
    </div>
  )
}
