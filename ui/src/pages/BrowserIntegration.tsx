import { useState, type FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Card, PageHeader } from '../components/ui'
import { isDesktopRuntime } from '../data/downloads'
import type { PageProps } from './types'

export default function BrowserIntegration(_props: PageProps) {
  const [ids, setIds] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const desktop = isDesktopRuntime()

  async function pair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setStatus(null)
    setError(null)
    try {
      const result = await invoke<string>('pair_chromium_extensions', {
        extensionIds: ids.split(',').map((id) => id.trim()).filter(Boolean),
      })
      setStatus(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="Browser Integration" description="Pair the Chromium extension with the installed Native Messaging host." />
      <div className="grid gap-4 md:grid-cols-2">
        {['Chrome', 'Edge', 'Brave'].map((browser) => (
          <Card key={browser} title={browser}>
            <p>Extension status: <strong>{status ? 'Host registered; restart browser and test connection' : 'Not verified'}</strong></p>
            <p className="mt-2 text-xs text-gray-500">Install the unpacked Chromium extension separately. Registration does not prove that the browser can launch the host.</p>
          </Card>
        ))}
        <Card title="Firefox">
          <p>Firefox packaging and its `allowed_extensions` host manifest are not implemented yet.</p>
        </Card>
      </div>
      {desktop ? (
        <form onSubmit={pair} className="mt-6 grid max-w-2xl gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <label htmlFor="extension-ids" className="font-medium">Chromium extension ID(s)</label>
          <input
            id="extension-ids"
            value={ids}
            onChange={(event) => setIds(event.target.value)}
            placeholder="32 letters a–p; separate multiple IDs with commas"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          />
          <p className="text-xs text-gray-500">Find the ID on each browser's extensions page. Registration writes the per-user Native Messaging manifest and HKCU entries for Chrome, Edge, and Brave.</p>
          <button type="submit" disabled={busy} className="w-fit rounded-md bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy ? 'Registering…' : 'Register Native Messaging host'}
          </button>
          {status && <p role="status" className="text-sm text-green-700">{status}</p>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        </form>
      ) : (
        <p className="mt-6 text-sm text-gray-600 dark:text-gray-300">Host registration is available in the Windows desktop build. This web preview does not access the operating-system registry.</p>
      )}
      <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
        The native host and framed protocol are implemented and tested locally. Verify a live ping in the extension popup, then send a user-selected URL before treating browser handoff as operational.
      </p>
    </div>
  )
}
