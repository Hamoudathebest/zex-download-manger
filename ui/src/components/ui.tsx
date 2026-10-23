import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { formatBytes, formatDuration, formatSpeed, type DownloadItem } from '../data/downloads'
import { PREVIEW_NOTICE } from '../data/preview'
import { Icon, type IconName } from './icons'

export { Icon } from './icons'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  size = 'normal',
  icon,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'normal' | 'small'
  icon?: IconName
}) {
  return (
    <button
      {...props}
      className={`button button-${variant} button-${size} interactive ${className}`}
    >
      {icon && <Icon name={icon} size={size === 'small' ? 15 : 17} />}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button {...props} type={props.type ?? 'button'} aria-label={label} title={label} className={`icon-button interactive ${className}`}>
      <Icon name={icon} />
    </button>
  )
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string
  description?: string
  eyebrow?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-heading">
      <div className="page-heading-copy">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </header>
  )
}

export function ConnectionBanner({
  connection,
  error,
  preview,
  onTogglePreview,
}: {
  connection: string
  error: string | null
  preview: boolean
  onTogglePreview: () => void
}) {
  const connected = connection === 'connected'
  return (
    <div className={`connection-banner ${preview ? 'connection-preview' : connected ? 'connection-ok' : 'connection-error'}`} role="status" aria-live="polite">
      <span className="connection-dot" />
      <div className="connection-copy">
        <strong>{preview ? 'Preview data' : connected ? 'Engine connected' : connection === 'loading' ? 'Connecting to engine' : 'Engine unavailable'}</strong>
        <span>{preview ? PREVIEW_NOTICE : connected ? 'Download state is being read from the desktop engine.' : connection === 'loading' ? 'Reading persisted download state…' : error ?? 'The desktop engine state could not be loaded.'}</span>
      </div>
      <button type="button" className="connection-preview-toggle" onClick={onTogglePreview} aria-pressed={preview}>
        {preview ? 'Exit preview' : 'Preview UI'}
      </button>
    </div>
  )
}

export function EmptyState({
  title = 'Nothing here yet',
  message,
  icon = 'download',
  action,
}: {
  title?: string
  message: string
  icon?: IconName
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={24} /></div>
      <h2>{title}</h2>
      <p>{message}</p>
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

const statusInfo: Record<string, { label: string; className: string; icon: IconName }> = {
  active: { label: 'Downloading', className: 'status-active', icon: 'download' },
  queued: { label: 'Queued', className: 'status-queued', icon: 'clock' },
  paused: { label: 'Paused', className: 'status-paused', icon: 'pause' },
  interrupted: { label: 'Interrupted', className: 'status-interrupted', icon: 'refresh' },
  completed: { label: 'Completed', className: 'status-completed', icon: 'check' },
  failed: { label: 'Failed', className: 'status-failed', icon: 'warning' },
  cancelled: { label: 'Cancelled', className: 'status-muted', icon: 'close' },
  scheduled: { label: 'Scheduled', className: 'status-queued', icon: 'calendar' },
}

export function StatusBadge({ status }: { status: string }) {
  const info = statusInfo[status] ?? { label: status, className: 'status-muted', icon: 'info' as const }
  return <span className={`status-badge ${info.className}`}><Icon name={info.icon} size={13} />{info.label}</span>
}

export function ProgressBar({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <div className="progress-unknown" aria-label={`${label}: progress unavailable`}>Waiting for size</div>
  const progress = Math.max(0, Math.min(100, value))
  return (
    <div className="progress-wrap">
      <div className="progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress for ${label}`}>
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="progress-value">{Math.round(progress)}%</span>
    </div>
  )
}

function sourceHost(url: string) {
  try { return new URL(url).hostname || url } catch { return url }
}

function fileIcon(name: string): IconName {
  const extension = name.split('.').pop()?.toLowerCase()
  if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(extension ?? '')) return 'video'
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(extension ?? '')) return 'music'
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(extension ?? '')) return 'archive'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension ?? '')) return 'image'
  if (['pdf', 'doc', 'docx', 'txt', 'csv'].includes(extension ?? '')) return 'document'
  return 'file'
}

function DownloadActions({
  item,
  onResume,
  onPause,
  onCancel,
  onOpenFile,
  onOpenFolder,
  onStartQueued,
}: {
  item: DownloadItem
  onResume?: (id: string) => Promise<void>
  onPause?: (id: string) => Promise<void>
  onCancel?: (id: string) => Promise<void>
  onOpenFile?: (id: string) => Promise<void>
  onOpenFolder?: (id: string) => Promise<void>
  onStartQueued?: (id: string) => Promise<void>
}) {
  return (
    <div className="download-actions">
      {item.status === 'queued' && item.startManually && onStartQueued && <Button size="small" variant="primary" icon="play" onClick={() => void onStartQueued(item.id)}>Start</Button>}
      {item.status === 'active' && onPause && <Button size="small" icon="pause" onClick={() => void onPause(item.id)}>Pause</Button>}
      {item.resumable && onResume && <Button size="small" variant="primary" icon="play" onClick={() => void onResume(item.id)}>Resume</Button>}
      {item.status === 'completed' && onOpenFile && <IconButton icon="external" label={`Open ${item.name}`} onClick={() => void onOpenFile(item.id)} />}
      {item.status === 'completed' && onOpenFolder && <IconButton icon="folder" label={`Show ${item.name} in folder`} onClick={() => void onOpenFolder(item.id)} />}
      {onCancel && ['active', 'queued', 'paused', 'interrupted', 'failed'].includes(item.status) && <Button size="small" variant="danger" icon="close" onClick={() => void onCancel(item.id)}>Cancel</Button>}
    </div>
  )
}

export function DownloadTable({
  items,
  preview,
  onResumeDownload,
  onPauseDownload,
  onCancelDownload,
  onOpenDetails,
  onOpenFile,
  onOpenFolder,
  onStartQueuedDownload,
  showViewToggle = true,
  initialView = 'table',
}: {
  items: DownloadItem[]
  preview: boolean
  onResumeDownload?: (id: string) => Promise<void>
  onPauseDownload?: (id: string) => Promise<void>
  onCancelDownload?: (id: string) => Promise<void>
  onOpenDetails?: (item: DownloadItem) => void
  onOpenFile?: (id: string) => Promise<void>
  onOpenFolder?: (id: string) => Promise<void>
  onStartQueuedDownload?: (id: string) => Promise<void>
  showViewToggle?: boolean
  initialView?: 'table' | 'list'
}) {
  const [view, setView] = useState<'table' | 'list'>(initialView)
  if (items.length === 0) {
    return <EmptyState icon="download" message="Your downloads will appear here when they are added." />
  }
  const actions = { onResume: onResumeDownload, onPause: onPauseDownload, onCancel: onCancelDownload, onOpenFile, onOpenFolder, onStartQueued: onStartQueuedDownload }
  return (
    <section className="download-list-shell">
      {showViewToggle && (
        <div className="list-toolbar">
          <div className="list-result-count">{items.length} {items.length === 1 ? 'download' : 'downloads'}{preview && <span className="preview-pill">PREVIEW</span>}</div>
          <div className="view-switch" role="group" aria-label="Download display mode">
            <IconButton icon="list" label="Table view" aria-pressed={view === 'table'} onClick={() => setView('table')} className={view === 'table' ? 'view-selected' : ''} />
            <IconButton icon="grid" label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')} className={view === 'list' ? 'view-selected' : ''} />
          </div>
        </div>
      )}
      {view === 'table' ? (
        <div className="table-scroll">
          <table className="download-table">
            <caption className="sr-only">{preview ? 'Static preview downloads, not live activity' : 'Downloads from the desktop engine'}</caption>
            <thead><tr><th>File</th><th>Status</th><th>Size</th><th className="progress-heading">Progress</th><th>Speed</th><th>Time left</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr className="table-row" key={item.id}>
                  <td className="file-cell">
                    <span className="file-icon"><Icon name={fileIcon(item.name)} size={18} /></span>
                    <div className="file-cell-copy">
                      <button type="button" className="file-name" onClick={() => onOpenDetails?.(item)} title={item.name}>{item.name}</button>
                      <span className="file-host" title={item.url}>{sourceHost(item.url)}</span>
                    </div>
                    {preview && <span className="preview-pill">DEMO</span>}
                  </td>
                  <td><StatusBadge status={item.status} /></td>
                  <td><div className="size-primary">{formatBytes(item.sizeBytes)}</div><div className="size-subtle">{formatBytes(item.downloadedBytes)} downloaded</div></td>
                  <td className="progress-cell"><ProgressBar value={item.progressPercent} label={item.name} /></td>
                  <td className="metric-cell">{formatSpeed(item.speedBytesPerSec)}</td>
                  <td className="metric-cell">{item.status === 'completed' ? '—' : formatDuration(item.etaSeconds)}</td>
                  <td><DownloadActions item={item} {...actions} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="download-card-list">
          {items.map((item) => (
            <article key={item.id} className="download-card-row" onDoubleClick={() => onOpenDetails?.(item)}>
              <span className="file-icon file-icon-large"><Icon name={fileIcon(item.name)} size={20} /></span>
              <div className="download-card-main">
                <div className="download-card-titleline">
                  <button type="button" className="file-name" onClick={() => onOpenDetails?.(item)}>{item.name}</button>
                  <StatusBadge status={item.status} />
                  {preview && <span className="preview-pill">DEMO</span>}
                </div>
                <span className="file-host" title={item.url}>{sourceHost(item.url)} · {formatBytes(item.downloadedBytes)} of {formatBytes(item.sizeBytes)}</span>
                <ProgressBar value={item.progressPercent} label={item.name} />
              </div>
              <div className="download-card-metrics"><strong>{formatSpeed(item.speedBytesPerSec)}</strong><span>{item.status === 'completed' ? 'Complete' : formatDuration(item.etaSeconds)}</span></div>
              <DownloadActions item={item} {...actions} />
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function StatCard({
  label,
  value,
  note,
  icon,
  tone = 'primary',
}: {
  label: string
  value: string
  note: string
  icon?: IconName
  tone?: 'primary' | 'cyan' | 'green' | 'amber'
}) {
  return (
    <section className={`stat-card stat-${tone}`} aria-label={label}>
      <div className="stat-top"><span>{label}</span>{icon && <span className="stat-icon"><Icon name={icon} size={18} /></span>}</div>
      <p className="stat-value">{value}</p>
      <p className="stat-note">{note}</p>
    </section>
  )
}

export function Card({ title, children, icon }: { title: string; children: ReactNode; icon?: IconName }) {
  return (
    <section className="settings-card">
      <header className="settings-card-header">{icon && <span className="settings-card-icon"><Icon name={icon} size={17} /></span>}<h2>{title}</h2></header>
      <div className="settings-card-body">{children}</div>
    </section>
  )
}

export function DisabledActionNote() {
  return <p className="inline-note"><Icon name="info" size={15} />Queue priority and scheduler automation are not implemented yet.</p>
}
