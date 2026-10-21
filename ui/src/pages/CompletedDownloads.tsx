import { DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function CompletedDownloads({ items, preview }: PageProps) {
  return (
    <div>
      <PageHeader title="Completed Downloads" description="Finished downloads, as reported by the engine. No files are opened from this prototype." />
      <DownloadTable items={items.filter((d) => d.status === 'completed')} preview={preview} />
    </div>
  )
}
