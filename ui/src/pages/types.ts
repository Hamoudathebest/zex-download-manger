import type { DownloadItem } from '../data/downloads'

export interface PageProps {
  items: DownloadItem[]
  connection: string
  error: string | null
  preview: boolean
  onTogglePreview: () => void
}

export const filterBy = (items: DownloadItem[], pred: (d: DownloadItem) => boolean) =>
  items.filter(pred)
