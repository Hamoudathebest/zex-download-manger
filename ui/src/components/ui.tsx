import type { ReactNode } from 'react'
import { formatBytes, formatDuration, formatSpeed, type DownloadItem } from '../data/downloads'
import { PREVIEW_NOTICE } from '../data/preview'

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{description}</p>
    </header>
  )
}

export function ConnectionBanner({
  connection, error, preview, onTogglePreview,
}: {
  connection: string
  error: string | null
  preview: boolean
  onTogglePreview: () => void
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      {preview ? (
        <p><strong>PREVIEW MODE.</strong> {PREVIEW_NOTICE} Turn it off to return to the disconnected state.</p>
      ) : connection === 'disconnected' ? (
        <p><strong>Download engine unavailable.</strong> Live progress is shown only when the desktop service or configured engine-state endpoint responds. {error}</p>
      ) : connection === 'connected' ? (
        <p><strong>Connected to the download engine.</strong> Values below come from the live engine state.</p>
      ) : (
        <p>Checking the download engine…</p>
      )}
      <button
        type="button"
        onClick={onTogglePreview}
        aria-pressed={preview}
        className="mt-3 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-gray-900"
      >
        {preview ? 'Exit labelled UI preview' : 'Show labelled UI preview (static, not live)'}
      </button>
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
      <p className="text-sm text-gray-600 dark:text-gray-300">{message}</p>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Downloads appear here after the desktop engine reports their actual state.
      </p>
    </div>
  )
}

export function DownloadTable({
  items,
  preview,
  onResumeDownload,
  onPauseDownload,
  onCancelDownload,
}: {
  items: DownloadItem[]
  preview: boolean
  onResumeDownload?: (id: string) => Promise<void>
  onPauseDownload?: (id: string) => Promise<void>
  onCancelDownload?: (id: string) => Promise<void>
}) {
  if (items.length === 0) return <EmptyState message="No downloads to show." />
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">
          {preview ? 'Static preview downloads — not live activity' : 'Downloads from the engine'}
        </caption>
        <thead className="bg-gray-100 dark:bg-gray-800">
          <tr>
            <th scope="col" className="px-4 py-2">Name</th>
            <th scope="col" className="px-4 py-2">Status</th>
            <th scope="col" className="px-4 py-2">Size</th>
            <th scope="col" className="px-4 py-2">Progress</th>
            <th scope="col" className="px-4 py-2">Speed</th>
            <th scope="col" className="px-4 py-2">ETA</th>
            {(onResumeDownload || onPauseDownload || onCancelDownload) && <th scope="col" className="px-4 py-2">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id} className="border-t border-gray-200 dark:border-gray-700">
              <td className="px-4 py-2">
                <span className="font-medium text-gray-900 dark:text-white">{d.name}</span>
                {preview && (
                  <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-bold text-amber-900">PREVIEW</span>
                )}
                <span className="block max-w-[280px] truncate text-xs text-gray-500">{d.url}</span>
              </td>
              <td className="px-4 py-2">{d.status}</td>
              <td className="px-4 py-2">{formatBytes(d.sizeBytes)}</td>
              <td className="px-4 py-2">
                {d.progressPercent === null ? (
                  '—'
                ) : (
                  <>
                    <span aria-label={`${d.progressPercent} percent complete`}>{d.progressPercent}%</span>
                    <span
                      role="progressbar"
                      aria-valuenow={d.progressPercent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Progress for ${d.name}`}
                      className="mt-1 block h-2 w-28 overflow-hidden rounded bg-gray-200 dark:bg-gray-700"
                    >
                      <span className="block h-full bg-blue-600" style={{ width: `${d.progressPercent}%` }} />
                    </span>
                  </>
                )}
              </td>
              <td className="px-4 py-2">{formatSpeed(d.speedBytesPerSec)}</td>
              <td className="px-4 py-2">{formatDuration(d.etaSeconds)}</td>
              {(onResumeDownload || onPauseDownload || onCancelDownload) && (
                <td className="px-4 py-2">
                  {d.status === 'active' && onPauseDownload && (
                    <button
                      type="button"
                      onClick={() => void onPauseDownload(d.id)}
                      className="mr-1 rounded border border-gray-500 px-2 py-1 text-xs font-medium"
                    >Pause</button>
                  )}
                  {d.resumable && onResumeDownload && (
                    <button
                      type="button"
                      onClick={() => void onResumeDownload(d.id)}
                      className="mr-1 rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white"
                    >
                      Resume
                    </button>
                  )}
                  {onCancelDownload && ['active', 'queued', 'paused', 'interrupted', 'failed'].includes(d.status) && (
                    <button
                      type="button"
                      onClick={() => void onCancelDownload(d.id)}
                      className="rounded border border-red-600 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-300"
                    >Cancel</button>
                  )}
                  {d.status !== 'active' && !d.resumable && !onCancelDownload && '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <section
      aria-label={label}
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</h2>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{note}</p>
    </section>
  )
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
    >
      <h2 className="mb-2 text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
      <div className="text-sm text-gray-700 dark:text-gray-200">{children}</div>
    </section>
  )
}

export function DisabledActionNote() {
  return (
    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
      Queue and scheduler controls are not implemented. Resume is enabled only when
      a matching partial file and checkpoint are present; no action is simulated otherwise.
    </p>
  )
}
