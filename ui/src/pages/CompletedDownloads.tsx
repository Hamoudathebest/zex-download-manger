import { DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function CompletedDownloads({ items, preview, onOpenDetails, onOpenFile, onOpenFolder }: PageProps) {
  return (
    <div>
      <PageHeader eyebrow="LIBRARY" title="Completed" description="Finished files ready to open or find in their destination folder." />
      <DownloadTable items={items.filter((item) => item.status === 'completed')} preview={preview} onOpenDetails={onOpenDetails} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} />
    </div>
  )
}
