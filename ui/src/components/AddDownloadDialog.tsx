import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { isDesktopRuntime, loadDesktopSettings, type DownloadCategory } from '../data/downloads'
import { Button, Icon, IconButton } from './ui'

type CategoryChoice = DownloadCategory | 'automatic'

export interface AddDownloadOptions {
  filename?: string
  destinationDirectory?: string
  category?: DownloadCategory
  startImmediately: boolean
}

export default function AddDownloadDialog({
  open,
  defaultFolder,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  open: boolean
  defaultFolder: string
  onClose: () => void
  onSubmit: (url: string, options: AddDownloadOptions) => Promise<void>
  busy: boolean
  error: string | null
}) {
  const [url, setUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [destinationDirectory, setDestinationDirectory] = useState(defaultFolder)
  const [category, setCategory] = useState<CategoryChoice>('automatic')
  const [startImmediately, setStartImmediately] = useState(true)
  const [advanced, setAdvanced] = useState(false)

  useEffect(() => {
    if (!open || !isDesktopRuntime()) return
    let alive = true
    void loadDesktopSettings().then((settings) => {
      if (alive) setDestinationDirectory((value) => value || settings.downloadDirectory)
    }).catch(() => {})
    return () => { alive = false }
  }, [open])

  const source = useMemo(() => {
    try { return new URL(url).hostname } catch { return '' }
  }, [url])

  function updateUrl(value: string) {
    setUrl(value)
    try {
      const pathName = new URL(value).pathname
      const last = pathName.split('/').filter(Boolean).pop()
      if (last) setFilename(decodeURIComponent(last))
    } catch { /* retain the filename while the URL is incomplete */ }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onSubmit(url.trim(), {
      filename: filename.trim() || undefined,
      destinationDirectory: destinationDirectory.trim() || undefined,
      category: category === 'automatic' ? undefined : category,
      startImmediately,
    })
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section className="add-dialog modal-panel" role="dialog" aria-modal="true" aria-labelledby="add-download-title">
        <header className="dialog-header">
          <div className="dialog-title-icon"><Icon name="cloud-download" size={21} /></div>
          <div className="dialog-title-copy"><h2 id="add-download-title">Add download</h2><p>Choose where this file belongs before the engine starts.</p></div>
          <IconButton icon="close" label="Close dialog" disabled={busy} onClick={onClose} />
        </header>
        <form onSubmit={submit}>
          <div className="dialog-body">
            <label className="control-label" htmlFor="add-url">Download URL</label>
            <div className="input-with-icon">
              <Icon name="link" size={17} />
              <input id="add-url" className="control-input" type="url" required autoFocus value={url} onChange={(event) => updateUrl(event.target.value)} placeholder="https://example.com/archive.zip" />
            </div>
            {source && <div className="url-source"><span className="source-dot" />Source: <strong>{source}</strong></div>}

            <div className="dialog-two-col">
              <label className="control-label">File name
                <input className="control-input" value={filename} onChange={(event) => setFilename(event.target.value)} placeholder="Detected from URL" />
              </label>
              <label className="control-label">Category
                <select className="control-input" value={category} onChange={(event) => setCategory(event.target.value as CategoryChoice)}>
                  <option value="automatic">Automatic</option>
                  <option value="file">File</option>
                  <option value="video">Video</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>

            <label className="control-label">Destination folder
              <div className="input-with-icon">
                <Icon name="folder" size={17} />
                <input className="control-input" value={destinationDirectory} onChange={(event) => setDestinationDirectory(event.target.value)} placeholder="Use the configured download folder" />
              </div>
            </label>

            <button type="button" className="advanced-toggle" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
              <Icon name="chevron-down" size={15} className={advanced ? 'rotate-180' : ''} />
              Advanced options
            </button>
            {advanced && (
              <div className="advanced-panel">
                <p><Icon name="settings" size={15} /> Connections, speed limit and retry count use the saved engine settings.</p>
                <p><Icon name="info" size={15} /> File metadata is checked by the Rust engine after you submit the URL.</p>
              </div>
            )}

            <label className="start-option">
              <input type="checkbox" checked={startImmediately} onChange={(event) => setStartImmediately(event.target.checked)} />
              <span className="custom-checkbox"><Icon name="check" size={13} /></span>
              <span><strong>Start immediately</strong><small>{startImmediately ? 'Starts when an engine slot is available.' : 'Hold in the queue until you start it.'}</small></span>
            </label>
            {error && <div role="alert" className="form-error"><Icon name="warning" size={16} />{error}</div>}
          </div>

          <footer className="dialog-footer">
            <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
            {!startImmediately && <Button type="submit" variant="secondary" icon="list" disabled={busy}>{busy ? 'Adding…' : 'Add to queue'}</Button>}
            {startImmediately && <Button type="submit" variant="primary" icon="download" disabled={busy}>{busy ? 'Adding…' : 'Download now'}</Button>}
          </footer>
        </form>
      </section>
    </div>
  )
}
