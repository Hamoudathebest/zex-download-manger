import { DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function DownloadHistory({ items, preview, onClearHistory }: PageProps) {
  const sorted = [...items].filter((item) => !['active', 'queued'].includes(item.status)).sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  return (
    <div>
      <PageHeader title="Download History" description="All recorded downloads, newest first, as reported by the engine." />
      {onClearHistory && <button type="button" onClick={() => void onClearHistory()} disabled={sorted.length === 0} className="mb-3 rounded border border-red-600 px-3 py-2 text-sm text-red-700 disabled:opacity-50 dark:text-red-300">Clear non-resumable history</button>}
      <DownloadTable items={sorted} preview={preview} />
    </div>
  )
}
