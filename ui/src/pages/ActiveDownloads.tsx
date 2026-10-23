import { DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function ActiveDownloads({ items, preview, onResumeDownload, onPauseDownload, onCancelDownload }: PageProps) {
  const active = items.filter((d) => ['active', 'paused', 'interrupted', 'failed'].includes(d.status))
  const resumable = active.filter((item) => item.resumable)
  const pausable = active.filter((item) => item.status === 'active')
  const cancellable = active.filter((item) => ['active', 'paused', 'interrupted', 'failed'].includes(item.status))
  return (
    <div>
      <PageHeader title="Active Downloads" description="Live, paused, and interrupted jobs reported by the engine." />
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!onPauseDownload || pausable.length === 0}
          onClick={() => pausable.forEach((item) => void onPauseDownload?.(item.id))}
          className="rounded-md border border-gray-400 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >Pause all</button>
        <button
          type="button"
          disabled={!onResumeDownload || resumable.length === 0}
          onClick={() => resumable.forEach((item) => void onResumeDownload?.(item.id))}
          aria-label="Resume all downloads that have a saved checkpoint"
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >Resume eligible</button>
        <button
          type="button"
          disabled={!onCancelDownload || cancellable.length === 0}
          onClick={() => cancellable.forEach((item) => void onCancelDownload?.(item.id))}
          className="rounded-md border border-red-600 px-3 py-2 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300"
        >Cancel all incomplete</button>
      </div>
      <DownloadTable items={active} preview={preview} onResumeDownload={onResumeDownload} onPauseDownload={onPauseDownload} onCancelDownload={onCancelDownload} />
    </div>
  )
}
