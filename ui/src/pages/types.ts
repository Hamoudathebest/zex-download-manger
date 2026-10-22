import type { DownloadItem } from '../data/downloads'

export interface PageProps {
  items: DownloadItem[]
  connection: string
  error: string | null
  preview: boolean
  onTogglePreview: () => void
  onResumeDownload?: (id: string) => Promise<void>
  onPauseDownload?: (id: string) => Promise<void>
  onCancelDownload?: (id: string) => Promise<void>
}

export const filterBy = (items: DownloadItem[], pred: (d: DownloadItem) => boolean) =>
  items.filter(pred)
