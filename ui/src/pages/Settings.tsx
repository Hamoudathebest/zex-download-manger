import { useEffect, useState, type FormEvent } from 'react'
import { Card, PageHeader } from '../components/ui'
import { isDesktopRuntime, loadDesktopSettings, saveDesktopSettings, type DesktopSettings } from '../data/downloads'
import type { PageProps } from './types'

const DEFAULT_SETTINGS: DesktopSettings = {
  downloadDirectory: '',
  connections: 4,
  maxConcurrentDownloads: 3,
  throttleBytesPerSec: 0,
  maxRetries: 5,
}

export default function Settings({ preview }: { preview: boolean } & Partial<PageProps>) {
  const desktop = isDesktopRuntime() && !preview
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!desktop) return
    let live = true
    void loadDesktopSettings().then((value) => {
      if (live) setSettings(value)
    }).catch((reason: unknown) => {
      if (live) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { live = false }
  }, [desktop])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setStatus('')
    setError(null)
    try {
      setSettings(await saveDesktopSettings(settings))
      setStatus('Settings saved. New downloads use these options; queued jobs use them when they start.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Configure the desktop download engine and appearance." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Appearance">
          <p>Use the Theme button in the navigation to switch the interface between light and dark modes.</p>
          <p className="mt-2 text-xs text-gray-500">Current preview mode: {preview ? 'ON (labelled static preview)' : 'OFF (live desktop state)'}</p>
        </Card>
        <Card title="Download engine settings">
          {!desktop ? <p>Engine settings are available in the desktop application.</p> : (
            <form onSubmit={save} className="grid gap-3">
              <label className="grid gap-1">Download folder
                <input type="text" required value={settings.downloadDirectory} onChange={(event) => setSettings({ ...settings, downloadDirectory: event.target.value })} className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
              </label>
              <label className="grid gap-1">Connections per download (1–32)
                <input type="number" min={1} max={32} required value={settings.connections} onChange={(event) => setSettings({ ...settings, connections: Number(event.target.value) })} className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
              </label>
              <label className="grid gap-1">Maximum simultaneous desktop downloads (1–16)
                <input type="number" min={1} max={16} required value={settings.maxConcurrentDownloads} onChange={(event) => setSettings({ ...settings, maxConcurrentDownloads: Number(event.target.value) })} className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
              </label>
              <p className="text-xs text-gray-500">Downloads started directly by the browser Native Messaging host use the folder, connection, throttle and retry settings, but are not serialized by the desktop queue limit.</p>
              <label className="grid gap-1">Speed limit (KiB/s; 0 = unlimited)
                <input type="number" min={0} step={1} required value={Math.round(settings.throttleBytesPerSec / 1024)} onChange={(event) => setSettings({ ...settings, throttleBytesPerSec: Number(event.target.value) * 1024 })} className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
              </label>
              <label className="grid gap-1">Retries per segment (1–20)
                <input type="number" min={1} max={20} required value={settings.maxRetries} onChange={(event) => setSettings({ ...settings, maxRetries: Number(event.target.value) })} className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800" />
              </label>
              <button type="submit" disabled={saving} className="w-fit rounded-md bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save settings'}</button>
              {status && <p role="status" className="text-sm text-green-700 dark:text-green-300">{status}</p>}
              {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
            </form>
          )}
        </Card>
        <Card title="Accessibility">
          <ul className="list-disc pl-5">
            <li>Skip link to main content on every page.</li>
            <li>Visible focus rings; Tab / Shift+Tab navigation; all nav items are real links/buttons.</li>
            <li>Tables use scope, caption, and labelled progress bars.</li>
            <li>Reduced-motion preference is honoured in CSS.</li>
          </ul>
        </Card>
        <Card title="Keyboard shortcuts">
          <ul className="list-disc pl-5">
            <li><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> — move focus</li>
            <li><kbd>Enter</kbd> / <kbd>Space</kbd> — activate the focused link or button</li>
            <li><kbd>/</kbd> — focus the search box</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
