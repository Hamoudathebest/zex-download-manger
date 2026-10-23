import { DownloadTable, EmptyState, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function DownloadQueue({ items, preview, onCancelDownload, onStartQueuedDownload, onOpenDetails }: PageProps) {
  const queued = items.filter((item) => item.status === 'queued')
  const held = queued.filter((item) => item.startManually).length
  return (
    <div>
      <PageHeader eyebrow="ORGANIZE" title="Queues" description="Waiting jobs start in insertion order as desktop download slots open." />
      {queued.length ? (
        <>
          <div className="queue-summary"><span className="queue-summary-icon"><span className="queue-summary-number">{queued.length}</span></span><div><strong>{queued.length} waiting</strong><small>{held ? `${held} held for manual start · ` : ''}Concurrency is configured in Settings.</small></div></div>
          <DownloadTable items={queued} preview={preview} onCancelDownload={onCancelDownload} onStartQueuedDownload={onStartQueuedDownload} onOpenDetails={onOpenDetails} />
        </>
      ) : (
        <EmptyState icon="list" title="The queue is clear" message="Downloads queued behind the active-slot limit will wait here. You can also choose Add to queue in the download dialog." />
      )}
      <p className="inline-note"><span className="queue-note-chip">Main queue</span> Single insertion-ordered queue · priority and reordering are not available yet</p>
    </div>
  )
}
