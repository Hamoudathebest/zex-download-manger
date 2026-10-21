import { DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function VideoDownloads({ items, preview }: PageProps) {
  return (
    <div>
      <PageHeader title="Video Downloads" description="Video-category downloads only. This prototype does not download, convert, or circumvent any protection on video content." />
      <DownloadTable items={items.filter((d) => d.category === 'video')} preview={preview} />
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        Supported sites, formats, and quality options are an engine / Phase 2 decision and are not claimed here.
      </p>
    </div>
  )
}
