import { Card, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function BrowserIntegration(_props: PageProps) {
  const browsers = ['Chrome', 'Firefox', 'Edge', 'Brave']
  return (
    <div>
      <PageHeader title="Browser Integration" description="Browser extension status. No extension is installed or verified by this prototype." />
      <div className="grid gap-4 md:grid-cols-2">
        {browsers.map((b) => (
          <Card key={b} title={b}>
            <p>Status: <strong>Not detected</strong> — extension installation and handshake are Phase 2 work.</p>
            <button type="button" disabled className="mt-3 rounded-md bg-gray-300 px-3 py-2 font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-60">Install extension (disabled in prototype)</button>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
        How it will work (Phase 2): the extension sends a download URL to the native app, which
        hands it to the engine. This web prototype intercepts nothing.
      </p>
    </div>
  )
}
