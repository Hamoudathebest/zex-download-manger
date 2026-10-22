import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { isDesktopRuntime, loadEngineState, startDesktopDownload, type DownloadsData } from './data/downloads'
import { previewDownloads } from './data/preview'
import Dashboard from './pages/Dashboard'
import ActiveDownloads from './pages/ActiveDownloads'
import CompletedDownloads from './pages/CompletedDownloads'
import VideoDownloads from './pages/VideoDownloads'
import DownloadQueue from './pages/DownloadQueue'
import Scheduler from './pages/Scheduler'
import BrowserIntegration from './pages/BrowserIntegration'
import DownloadHistory from './pages/DownloadHistory'
import Settings from './pages/Settings'
import PerformanceStatistics from './pages/PerformanceStatistics'

const ROUTES = [
  { slug: 'dashboard', label: 'Dashboard' },
  { slug: 'active', label: 'Active Downloads' },
  { slug: 'completed', label: 'Completed Downloads' },
  { slug: 'video', label: 'Video Downloads' },
  { slug: 'queue', label: 'Download Queue' },
  { slug: 'scheduler', label: 'Scheduler' },
  { slug: 'browser', label: 'Browser Integration' },
  { slug: 'history', label: 'Download History' },
  { slug: 'settings', label: 'Settings' },
  { slug: 'stats', label: 'Performance Statistics' },
] as const

type RouteSlug = (typeof ROUTES)[number]['slug']

function slugFromHash(): RouteSlug {
  const slug = window.location.hash.replace('#/', '').replace('#', '')
  return ROUTES.some((r) => r.slug === slug) ? (slug as RouteSlug) : 'dashboard'
}

export default function App() {
  const [route, setRoute] = useState<RouteSlug>(() => slugFromHash())
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('dm-theme')
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [preview, setPreview] = useState(false)
  const [query, setQuery] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [data, setData] = useState<DownloadsData>({ connection: 'loading', engine: null, error: null })
  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('dm-theme', theme)
  }, [theme])

  useEffect(() => {
    const onHash = () => setRoute(slugFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => loadEngineState(controller.signal).then((next) => {
      if (!controller.signal.aborted) setData(next)
    })
    void refresh()
    const timer = isDesktopRuntime() ? window.setInterval(() => void refresh(), 1000) : undefined
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [])

  async function addDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAdding(true)
    setAddError(null)
    try {
      await startDesktopDownload(downloadUrl.trim())
      setDownloadUrl('')
      setData(await loadEngineState())
    } catch (error) {
      setAddError(error instanceof Error ? error.message : String(error))
    } finally {
      setAdding(false)
    }
  }

  // "/" focuses search; Escape clears it. Navigation focus moves to main on route change.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { mainRef.current?.focus() }, [route])

  const items = useMemo(() => {
    const base = preview ? previewDownloads : (data.engine?.downloads ?? [])
    if (!query.trim()) return base
    return base.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
  }, [preview, data, query])

  const props = {
    items, connection: preview ? 'preview' : data.connection, error: data.error,
    preview, onTogglePreview: () => setPreview((p) => !p),
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3 focus:text-black">
        Skip to main content
      </a>
      <div className="flex min-h-screen flex-col md:flex-row">
        <nav aria-label="Primary" className="w-full shrink-0 border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 md:w-64 md:border-r md:border-b-0">
          <p className="mb-4 text-lg font-bold">Download Manager <span className="block text-xs font-normal text-gray-500">Phase 1 web prototype</span></p>
          <ul className="flex flex-row flex-wrap gap-1 md:flex-col">
            {ROUTES.map((r) => (
              <li key={r.slug}>
                <a
                  href={`#/${r.slug}`}
                  aria-current={route === r.slug ? 'page' : undefined}
                  className={`block rounded-md px-3 py-2 text-sm font-medium ${route === r.slug ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}`}
                >
                  {r.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (currently ${theme})`}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-medium dark:border-gray-600"
            >
              Theme: {theme} — switch
            </button>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400" role="status">
              Engine: {preview ? 'Labelled preview (not live)' : data.connection === 'connected' ? 'Connected' : data.connection === 'loading' ? 'Checking…' : 'Disconnected'}
            </p>
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
            <label className="sr-only" htmlFor="global-search">Search downloads by name</label>
            <input
              id="global-search"
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search downloads… (press / to focus)"
              className="w-full max-w-md rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
            {isDesktopRuntime() && (
              <form onSubmit={addDownload} className="mt-3 flex max-w-3xl gap-2">
                <label className="sr-only" htmlFor="new-download-url">Download URL</label>
                <input
                  id="new-download-url"
                  type="url"
                  required
                  value={downloadUrl}
                  onChange={(event) => setDownloadUrl(event.target.value)}
                  placeholder="Paste an http(s) download URL"
                  className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                />
                <button
                  type="submit"
                  disabled={adding}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {adding ? 'Adding…' : 'Add download'}
                </button>
                {addError && <p role="alert" className="self-center text-sm text-red-600">{addError}</p>}
              </form>
            )}
          </div>
          <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto max-w-5xl px-4 py-6 outline-none">
            {route === 'dashboard' && <Dashboard {...props} />}
            {route === 'active' && <ActiveDownloads {...props} />}
            {route === 'completed' && <CompletedDownloads {...props} />}
            {route === 'video' && <VideoDownloads {...props} />}
            {route === 'queue' && <DownloadQueue {...props} />}
            {route === 'scheduler' && <Scheduler {...props} />}
            {route === 'browser' && <BrowserIntegration {...props} />}
            {route === 'history' && <DownloadHistory {...props} />}
            {route === 'settings' && <Settings {...props} />}
            {route === 'stats' && <PerformanceStatistics {...props} />}
          </main>
          <footer className="px-4 pb-6 text-center text-xs text-gray-500 dark:text-gray-400">
            {isDesktopRuntime()
              ? 'ZEX desktop development build — downloads are handled by the Rust engine.'
              : 'Web preview — live downloads require the packaged ZEX desktop application.'}
          </footer>
        </div>
      </div>
    </div>
  )
}
