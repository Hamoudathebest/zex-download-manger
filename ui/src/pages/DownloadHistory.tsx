import { DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function DownloadHistory({ items, preview }: PageProps) {
  const sorted = [...items].sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  return (
    <div>
      <PageHeader title="Download History" description="All recorded downloads, newest first, as reported by the engine." />
      <DownloadTable items={sorted} preview={preview} />
    </div>
  )
}
