import { DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function DownloadQueue({ items, preview, onCancelDownload }: PageProps) {
  return (
    <div>
      <PageHeader title="Download Queue" description="Downloads waiting for a configured engine slot. Jobs start automatically in submission order." />
      <DownloadTable items={items.filter((d) => d.status === 'queued')} preview={preview} onCancelDownload={onCancelDownload} />
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">The engine starts queued downloads as active slots become available. Queue reordering is not supported yet.</p>
    </div>
  )
}
