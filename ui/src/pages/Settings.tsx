import { useEffect, useState, type FormEvent } from 'react'
import { Button, Icon } from '../components/ui'
import { isDesktopRuntime, loadDesktopSettings, saveDesktopSettings, type DesktopSettings } from '../data/downloads'
import type { PageProps } from './types'
import type { ThemeMode } from '../App'

type Section = 'downloads' | 'speed' | 'appearance' | 'browser' | 'notifications' | 'advanced'

const SECTIONS: { id: Section; label: string; icon: 'folder' | 'zap' | 'sun' | 'browser' | 'info' | 'settings' }[] = [
  { id: 'downloads', label: 'Downloads', icon: 'folder' },
  { id: 'speed', label: 'Connections & speed', icon: 'zap' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'browser', label: 'Browser integration', icon: 'browser' },
  { id: 'notifications', label: 'Notifications', icon: 'info' },
  { id: 'advanced', label: 'Advanced', icon: 'settings' },
]

export default function Settings({
  preview,
  connection,
  theme,
  onThemeChange,
  settings: sharedSettings,
  onSettingsSaved,
}: PageProps & {
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
  settings: DesktopSettings | null
  onSettingsSaved: (settings: DesktopSettings) => void
}) {
  const desktop = isDesktopRuntime() && !preview
  const [section, setSection] = useState<Section>('downloads')
  const [draftSettings, setDraftSettings] = useState<DesktopSettings | null>(null)
  const settings = draftSettings ?? sharedSettings
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktop || settings) return
    let alive = true
    void loadDesktopSettings().then((value) => { if (alive) setDraftSettings(value) }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { alive = false }
  }, [desktop, settings])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings) return
    setSaving(true)
    setMessage('')
    setError(null)
    try {
      const saved = await saveDesktopSettings(settings)
      setDraftSettings(saved)
      onSettingsSaved(saved)
      setMessage('Settings saved. New downloads and queued desktop jobs will use these values.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-nav-heading">PREFERENCES</div>
          {SECTIONS.map((item) => (
            <button type="button" key={item.id} aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)}>
              <Icon name={item.icon} size={16} />{item.label}
            </button>
          ))}
        </nav>
        <section className="settings-content" aria-label={`${SECTIONS.find((item) => item.id === section)?.label ?? ''} settings`}>
          {section === 'downloads' && <>
            <div className="settings-intro"><span className="eyebrow">ENGINE</span><h2>Download defaults</h2><p>Choose where downloads go and how they are categorized.</p></div>
            <div className="settings-card">
              <header className="settings-card-header"><span className="settings-card-icon"><Icon name="folder" size={17} /></span><div><h3>Default destination</h3><p>Applied to downloads started from the desktop or browser.</p></div></header>
              <div className="settings-card-body">
                {desktop && settings ? <form className="settings-form" onSubmit={save}>
                  <label className="control-label">Download folder
                      <input className="control-input" type="text" required value={settings.downloadDirectory} onChange={(event) => setDraftSettings({ ...settings, downloadDirectory: event.target.value })} />
                  </label>
                  <div className="settings-help"><Icon name="info" size={15} />Native Messaging downloads inherit this destination and the per-download transfer limits.</div>
                  <div className="settings-save-row"><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>{message && <span role="status" className="settings-message">{message}</span>}{error && <span role="alert" className="settings-error">{error}</span>}</div>
                </form> : <p className="settings-empty">Engine settings can be edited from the installed ZEX desktop application.</p>}
              </div>
            </div>
            <div className="settings-card settings-card-inline">
              <div><span className="settings-card-icon"><Icon name="archive" size={17} /></span><div><h3>History storage</h3><p>Download records and settings are stored locally as JSON in application data.</p></div></div>
              <span className="settings-state-pill">LOCAL ONLY</span>
            </div>
          </>}

          {section === 'speed' && <>
            <div className="settings-intro"><span className="eyebrow">ENGINE</span><h2>Connections & speed</h2><p>Control the resources used by new desktop downloads.</p></div>
            <div className="settings-card">
              <header className="settings-card-header"><span className="settings-card-icon accent-cyan"><Icon name="zap" size={17} /></span><div><h3>Transfer limits</h3><p>Changes apply when a new download starts or a queued item is dispatched.</p></div></header>
              <div className="settings-card-body">
                {desktop && settings ? <form className="settings-form" onSubmit={save}>
                  <div className="settings-form-grid">
                    <label className="control-label">Connections per download
                      <input className="control-input" type="number" min={1} max={32} required value={settings.connections} onChange={(event) => setDraftSettings({ ...settings, connections: Number(event.target.value) })} />
                      <small>1–32. The engine falls back to one when the server does not support ranges.</small>
                    </label>
                    <label className="control-label">Maximum desktop downloads
                      <input className="control-input" type="number" min={1} max={16} required value={settings.maxConcurrentDownloads} onChange={(event) => setDraftSettings({ ...settings, maxConcurrentDownloads: Number(event.target.value) })} />
                      <small>1–16 concurrent desktop engine jobs.</small>
                    </label>
                    <label className="control-label">Speed limit (KiB/s)
                      <input className="control-input" type="number" min={0} step={1} required value={Math.round(settings.throttleBytesPerSec / 1024)} onChange={(event) => setDraftSettings({ ...settings, throttleBytesPerSec: Number(event.target.value) * 1024 })} />
                      <small>0 means unlimited. Applied to each download process, not globally across all processes.</small>
                    </label>
                    <label className="control-label">Retries per segment
                      <input className="control-input" type="number" min={1} max={20} required value={settings.maxRetries} onChange={(event) => setDraftSettings({ ...settings, maxRetries: Number(event.target.value) })} />
                      <small>1–20 automatic attempts for a failed segment.</small>
                    </label>
                  </div>
                  <div className="settings-save-row"><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>{message && <span role="status" className="settings-message">{message}</span>}{error && <span role="alert" className="settings-error">{error}</span>}</div>
                </form> : <p className="settings-empty">Engine settings are available in the installed desktop application.</p>}
              </div>
            </div>
            <div className="settings-notice"><Icon name="info" size={16} /><span>Native Messaging downloads use the saved folder, connections, throttle and retry policy. They are not serialized by the desktop queue limit.</span></div>
          </>}

          {section === 'appearance' && <>
            <div className="settings-intro"><span className="eyebrow">PERSONALIZE</span><h2>Appearance</h2><p>Choose the visual mode for the ZEX workspace.</p></div>
            <div className="settings-card">
              <header className="settings-card-header"><span className="settings-card-icon accent-violet"><Icon name="sun" size={17} /></span><div><h3>Color theme</h3><p>The system option follows your Windows theme preference.</p></div></header>
              <div className="theme-picker">
                {([
                  ['dark', 'moon', 'Dark', 'Deep navy surfaces'],
                  ['light', 'sun', 'Light', 'Soft neutral surfaces'],
                  ['system', 'system', 'System', 'Follow Windows'],
                ] as const).map(([value, icon, label, note]) => (
                  <button type="button" key={value} className={`theme-choice ${theme === value ? 'theme-choice-selected' : ''}`} aria-pressed={theme === value} onClick={() => onThemeChange(value)}>
                    <div className={`theme-swatch theme-swatch-${value}`}><span /><span /><span /></div>
                    <div className="theme-choice-copy"><strong><Icon name={icon} size={14} />{label}</strong><small>{note}</small></div>
                    <span className="theme-radio" />
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-card settings-card-inline"><div><span className="settings-card-icon"><Icon name="info" size={17} /></span><div><h3>Accessible by default</h3><p>Keyboard focus, reduced-motion preferences and high-contrast text are supported.</p></div></div><span className="settings-state-pill">READY</span></div>
          </>}

          {section === 'browser' && <>
            <div className="settings-intro"><span className="eyebrow">INTEGRATIONS</span><h2>Browser integration</h2><p>Pair the companion extension with the local Native Messaging host.</p></div>
            <div className="settings-card">
              <header className="settings-card-header"><span className="settings-card-icon accent-cyan"><Icon name="browser" size={17} /></span><div><h3>Chromium handoff</h3><p>Chrome, Edge and Brave share the installed host registration flow.</p></div></header>
              <div className="settings-card-body"><p>Downloads are sent only after an explicit extension action. Browser cookies and session credentials are never forwarded.</p><div className="settings-save-row"><Button variant="primary" icon="external" onClick={() => { window.location.hash = '#/browser' }}>Open browser integration</Button><span className="settings-help-text">Pairing does not replace a live connection test.</span></div></div>
            </div>
          </>}

          {section === 'notifications' && <>
            <div className="settings-intro"><span className="eyebrow">ALERTS</span><h2>Notifications</h2><p>Choose which events should reach you.</p></div>
            <div className="settings-card"><div className="settings-placeholder"><span className="placeholder-icon"><Icon name="info" size={20} /></span><strong>Desktop notifications are not wired yet</strong><p>ZEX currently shows in-app status and errors. Completion notifications will be added with a tested Windows notification provider.</p></div></div>
          </>}

          {section === 'advanced' && <>
            <div className="settings-intro"><span className="eyebrow">SYSTEM</span><h2>Advanced</h2><p>Application diagnostics and behavior.</p></div>
            <div className="settings-card settings-card-inline"><div><span className="settings-card-icon"><Icon name="activity" size={17} /></span><div><h3>Engine connection</h3><p>The desktop process launches the bundled Rust engine directly.</p></div></div><span className={`settings-state-pill ${connection === 'connected' ? 'pill-green' : ''}`}>{connection === 'connected' ? 'CONNECTED' : 'LOCAL'}</span></div>
            <div className="settings-card"><div className="settings-placeholder"><span className="placeholder-icon"><Icon name="settings" size={20} /></span><strong>Advanced engine options</strong><p>Proxy, adaptive segmentation, checksum policy and tray lifecycle controls are not exposed by the current engine contract.</p></div></div>
          </>}
        </section>
      </div>
    </div>
  )
}
