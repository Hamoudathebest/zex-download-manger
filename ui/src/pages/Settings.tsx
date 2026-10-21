import { Card, PageHeader } from '../components/ui'
import type { PageProps } from './types'

export default function Settings({ preview }: { preview: boolean } & Partial<PageProps>) {
  return (
    <div>
      <PageHeader title="Settings" description="Prototype preferences only. These are stored in this browser (localStorage) and do NOT configure a download engine." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Appearance">
          <p>Theme is toggled from the header (Dark / Light). It follows the <code>.dark</code> class on the document element and respects <code>prefers-color-scheme</code> on first visit.</p>
          <p className="mt-2 text-xs text-gray-500">Current preview mode: {preview ? 'ON (labelled static preview)' : 'OFF (disconnected)'}</p>
        </Card>
        <Card title="Downloads (engine settings — not connected)">
          <p>Download folder, connection count, speed limits, and retry policy are engine settings. They are shown here as read-only placeholders and cannot be applied from this prototype.</p>
          <label className="mt-3 grid gap-1">Default download folder (placeholder)
            <input type="text" disabled aria-label="Default download folder (placeholder, disabled)" placeholder="~/Downloads" className="rounded-md border border-gray-300 px-3 py-2 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800" />
          </label>
        </Card>
        <Card title="Accessibility">
          <ul className="list-disc pl-5">
            <li>Skip link to main content on every page.</li>
            <li>Visible focus rings; Tab / Shift+Tab navigation; all nav items are real links/buttons.</li>
            <li>Tables use scope, caption, and labelled progress bars.</li>
            <li>Reduced-motion preference is honoured in CSS.</li>
            <li>Dark and light themes both meet the layout contrast of Tailwind gray-900 / white text on their backgrounds; verify with a checker before release.</li>
          </ul>
        </Card>
        <Card title="Keyboard shortcuts">
          <ul className="list-disc pl-5">
            <li><kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> — move focus</li>
            <li><kbd>Enter</kbd> / <kbd>Space</kbd> — activate the focused link or button</li>
            <li><kbd>/</kbd> — focus the search box (where present)</li>
          </ul>
          <p className="mt-2 text-xs text-gray-500">No shortcut starts, pauses, or cancels a download in this prototype.</p>
        </Card>
      </div>
    </div>
  )
}
