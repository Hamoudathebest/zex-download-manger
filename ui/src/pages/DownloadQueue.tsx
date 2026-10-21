import { DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function DownloadQueue({ items, preview }: PageProps) {
  return (
    <div>
      <PageHeader title="Download Queue" description="Waiting downloads in queue order, as reported by the engine." />
      <DownloadTable items={items.filter((d) => d.status === 'queued')} preview={preview} />
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Reordering is disabled in this prototype: there is no engine queue to reorder.</p>
    </div>
  )
}
