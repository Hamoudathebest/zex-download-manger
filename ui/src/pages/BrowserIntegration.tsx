import { useState, type FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button, Card, Icon, PageHeader } from '../components/ui'
import { isDesktopRuntime } from '../data/downloads'
import type { PageProps } from './types'

const browsers = [
  { name: 'Chrome', mark: 'C', className: 'browser-chrome' },
  { name: 'Microsoft Edge', mark: 'E', className: 'browser-edge' },
  { name: 'Brave', mark: 'B', className: 'browser-brave' },
]

export default function BrowserIntegration({ connection }: PageProps) {
  const [ids, setIds] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const desktop = isDesktopRuntime()
  const extensionIds = ids.split(',').map((id) => id.trim().toLowerCase()).filter(Boolean)
  const validIds = extensionIds.length > 0 && extensionIds.every((id) => /^[a-p]{32}$/i.test(id))

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validIds) return
    setBusy(true)
    setStatus(null)
    setError(null)
    try {
      const result = await invoke<string>('pair_chromium_extensions', { extensionIds })
      setStatus(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Browser integration" description="Register the ZEX Native Messaging host for Chromium-based browsers." eyebrow="INTEGRATIONS" />
      <div className="browser-overview">
        <div className="browser-integration-state"><span className={`integration-state-dot ${status ? 'integration-registered' : ''}`} /><div><strong>{status ? 'Host registration completed' : 'Connection not verified'}</strong><small>{status ? 'Restart the browser, then verify its connection from the extension.' : 'Registration is a setup step; a live extension ping has not been confirmed here.'}</small></div></div>
        <span className="settings-state-pill">{status ? 'REGISTERED' : 'AWAITING SETUP'}</span>
      </div>

      <div className="browser-cards">
        {browsers.map((browser) => <Card title={browser.name} key={browser.name}>
          <div className="browser-card-content"><span className={`browser-mark ${browser.className}`}>{browser.mark}</span><div><strong>{status ? 'Host registered' : 'Setup required'}</strong><p>Install the ZEX companion extension separately, then restart this browser.</p></div><Icon name={status ? 'check' : 'clock'} size={16} /></div>
        </Card>)}
        <Card title="Firefox">
          <div className="browser-card-content"><span className="browser-mark browser-firefox">F</span><div><strong>Not packaged</strong><p>Firefox host registration with the allowed-extensions manifest is not supported yet.</p></div><Icon name="info" size={16} /></div>
        </Card>
      </div>

      <div className="browser-setup-grid">
        <Card title="Register the host" icon="settings">
          {desktop ? <form onSubmit={pair} className="browser-pair-form">
            <label className="control-label" htmlFor="extension-ids">Chromium extension ID(s)
              <input id="extension-ids" className="control-input" value={ids} onChange={(event) => setIds(event.target.value)} placeholder="32 letters a–p; separate IDs with commas" aria-describedby="extension-id-help" />
            </label>
            <p id="extension-id-help" className="settings-help"><Icon name="info" size={15} />Find the ID on the extension details page. Registration writes the per-user host manifest and HKCU browser entries.</p>
            <div className="settings-save-row"><Button type="submit" variant="primary" icon="link" disabled={busy || !validIds}>{busy ? 'Registering…' : 'Register Native Messaging host'}</Button>{validIds && <span className="settings-help-text">{extensionIds.length} valid extension {extensionIds.length === 1 ? 'ID' : 'IDs'}</span>}</div>
            {status && <p role="status" className="browser-result browser-result-success"><Icon name="check" size={15} />{status}</p>}
            {error && <p role="alert" className="browser-result browser-result-error"><Icon name="warning" size={15} />{error}</p>}
          </form> : <div className="browser-preview-note"><Icon name="info" size={17} /><p>Host registration is available in the installed desktop build. This preview cannot access the operating-system registry.</p></div>}
        </Card>
        <Card title="Verify handoff" icon="check">
          <ol className="verify-steps">
            <li><span>1</span><div><strong>Restart your browser</strong><small>Browsers load Native Messaging host registrations at startup.</small></div></li>
            <li><span>2</span><div><strong>Check the extension connection</strong><small>Open the ZEX extension popup and verify its live ping.</small></div></li>
            <li><span>3</span><div><strong>Send a selected URL</strong><small>Confirm an explicit browser handoff appears in the desktop queue.</small></div></li>
          </ol>
          <div className="browser-engine-state"><span className={`engine-state-dot ${connection}`} />Desktop engine: {connection === 'connected' ? 'connected' : connection === 'loading' ? 'connecting' : 'unavailable'}</div>
        </Card>
      </div>
      <p className="inline-note"><Icon name="info" size={15} />Registration does not itself prove that a browser can launch the host. Live Native Messaging verification remains a separate step.</p>
    </div>
  )
}
