import { DownloadTable, EmptyState, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function ActiveDownloads({ items, preview, onOpenDetails, onPauseDownload, onCancelDownload, onOpenFile, onOpenFolder }: PageProps) {
  const active = items.filter((item) => item.status === 'active')
  return (
    <div>
      <PageHeader title="Downloading" description="Live transfer state from the Rust download engine." eyebrow="TRANSFERS" />
      {active.length ? (
        <DownloadTable items={active} preview={preview} onPauseDownload={onPauseDownload} onCancelDownload={onCancelDownload} onOpenDetails={onOpenDetails} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} />
      ) : (
        <EmptyState icon="activity" title="No active transfers" message="Downloads will appear here as soon as the engine starts a transfer." />
      )}
    </div>
  )
}
