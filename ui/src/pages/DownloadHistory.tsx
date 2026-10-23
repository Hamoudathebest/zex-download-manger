import { Button, DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function DownloadHistory({ items, preview, onClearHistory, onResumeDownload, onCancelDownload, onOpenDetails, onOpenFile, onOpenFolder }: PageProps) {
  const sorted = [...items]
    .filter((item) => !['active', 'queued'].includes(item.status))
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  return (
    <div>
      <PageHeader
        eyebrow="LIBRARY"
        title="History"
        description="Finished, paused and interrupted jobs recorded by ZEX."
        actions={onClearHistory && <Button icon="trash" variant="ghost" disabled={!sorted.length} onClick={() => void onClearHistory()}>Clear non-resumable</Button>}
      />
      <DownloadTable items={sorted} preview={preview} onOpenDetails={onOpenDetails} onResumeDownload={onResumeDownload} onCancelDownload={onCancelDownload} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} />
    </div>
  )
}
