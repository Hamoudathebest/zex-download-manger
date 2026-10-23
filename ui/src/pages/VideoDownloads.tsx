import { DownloadTable, EmptyState, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function VideoDownloads({ items, preview, onOpenDetails, onPauseDownload, onResumeDownload, onCancelDownload, onOpenFile, onOpenFolder }: PageProps) {
  const videos = items.filter((item) => item.category === 'video')
  return (
    <div>
      <PageHeader title="Video downloads" description="Files categorized as video by the local engine." eyebrow="LIBRARY" />
      {videos.length ? <DownloadTable items={videos} preview={preview} onOpenDetails={onOpenDetails} onPauseDownload={onPauseDownload} onResumeDownload={onResumeDownload} onCancelDownload={onCancelDownload} onOpenFile={onOpenFile} onOpenFolder={onOpenFolder} /> : <EmptyState icon="video" title="No video files yet" message="Video downloads will appear here when their filename uses a recognized video extension or the category is selected in Add download." />}
      <p className="inline-note">Video site extraction, format conversion and quality selection are not supported by the current engine.</p>
    </div>
  )
}
