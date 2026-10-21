import { DisabledActionNote, DownloadTable, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function ActiveDownloads({ items, preview }: PageProps) {
  const active = items.filter((d) => d.status === 'active' || d.status === 'paused')
  return (
    <div>
      <PageHeader title="Active Downloads" description="Downloads currently in progress or paused, as reported by the engine." />
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" disabled aria-label="Pause all (disabled: no engine connected in this prototype)" className="rounded-md bg-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-60">Pause all</button>
        <button type="button" disabled aria-label="Resume all (disabled: no engine connected in this prototype)" className="rounded-md bg-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-60">Resume all</button>
      </div>
      <DownloadTable items={active} preview={preview} />
      <DisabledActionNote />
    </div>
  )
}
