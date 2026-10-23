import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelDesktopDownload,
  clearDesktopHistory,
  isDesktopRuntime,
  loadEngineState,
  loadDesktopSettings,
  openContainingFolder,
  openDownloadedFile,
  pauseDesktopDownload,
  resumeDesktopDownload,
  startDesktopDownload,
  startQueuedDesktopDownload,
  type DownloadItem,
  type DownloadsData,
} from './data/downloads'
import type { DesktopSettings } from './data/downloads'
import { previewDownloads } from './data/preview'
import AddDownloadDialog, { type AddDownloadOptions } from './components/AddDownloadDialog'
import DownloadDetailsDialog from './components/DownloadDetailsDialog'
import { Button, DownloadTable, Icon, IconButton, PageHeader } from './components/ui'
import type { IconName } from './components/icons'
import type { PageProps } from './pages/types'
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

type RouteSlug = 'dashboard' | 'all' | 'active' | 'paused' | 'completed' | 'queue' | 'scheduler' | 'video' | 'history' | 'browser' | 'settings' | 'stats'
export type ThemeMode = 'system' | 'dark' | 'light'
const EMPTY_DOWNLOADS: DownloadItem[] = []

const NAVIGATION: { slug: RouteSlug; label: string; icon: IconName; section?: string; accessibleName?: string }[] = [
  { slug: 'dashboard', label: 'Dashboard', icon: 'home', section: 'Workspace' },
  { slug: 'all', label: 'All downloads', icon: 'grid', section: 'Workspace' },
  { slug: 'active', label: 'Downloading', icon: 'download', section: 'Workspace', accessibleName: 'Active Downloads' },
  { slug: 'paused', label: 'Paused', icon: 'pause', section: 'Workspace' },
  { slug: 'completed', label: 'Completed', icon: 'check', section: 'Workspace', accessibleName: 'Completed Downloads' },
  { slug: 'queue', label: 'Queues', icon: 'list', section: 'Organize', accessibleName: 'Download Queue' },
  { slug: 'scheduler', label: 'Scheduler', icon: 'calendar', section: 'Organize' },
  { slug: 'video', label: 'Video downloads', icon: 'video', section: 'Library' },
  { slug: 'history', label: 'History', icon: 'history', section: 'Library', accessibleName: 'Download History' },
  { slug: 'browser', label: 'Browser integration', icon: 'browser', section: 'Preferences', accessibleName: 'Browser Integration' },
  { slug: 'settings', label: 'Settings', icon: 'settings', section: 'Preferences' },
]

const TITLES: Record<RouteSlug, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'A live view of your download activity.' },
  all: { title: 'All downloads', subtitle: 'Search and manage every download in your library.' },
  active: { title: 'Downloading', subtitle: 'Track current transfers and their engine-reported progress.' },
  paused: { title: 'Paused & interrupted', subtitle: 'Resume jobs that have a verified checkpoint.' },
  completed: { title: 'Completed', subtitle: 'Files the engine has finished and verified.' },
  queue: { title: 'Queues', subtitle: 'Work waiting for an available desktop download slot.' },
  scheduler: { title: 'Scheduler', subtitle: 'Plan when queued downloads should run.' },
  video: { title: 'Video downloads', subtitle: 'Files categorized as video by their extension.' },
  history: { title: 'History', subtitle: 'Recent finished and paused download records.' },
  browser: { title: 'Browser integration', subtitle: 'Connect Chromium browsers to the desktop download engine.' },
  settings: { title: 'Settings', subtitle: 'Personalize the application and configure the download engine.' },
  stats: { title: 'Performance', subtitle: 'Metrics derived from observed download state.' },
}

function slugFromHash(): RouteSlug {
  const slug = window.location.hash.replace('#/', '').replace('#', '')
  return NAVIGATION.some((item) => item.slug === slug) || slug === 'stats' ? slug as RouteSlug : 'dashboard'
}

function readTheme(): ThemeMode {
  const saved = localStorage.getItem('zex-theme') ?? localStorage.getItem('dm-theme')
  if (saved === 'dark' || saved === 'light' || saved === 'system') return saved
  return 'system'
}

function useTheme(mode: ThemeMode) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    }
    apply()
    localStorage.setItem('zex-theme', mode)
    const listener = () => { if (mode === 'system') apply() }
    media.addEventListener?.('change', listener)
    return () => media.removeEventListener?.('change', listener)
  }, [mode])
}

export default function App() {
  const [route, setRoute] = useState<RouteSlug>(() => slugFromHash())
  const [theme, setTheme] = useState<ThemeMode>(readTheme)
  const [preview, setPreview] = useState(false)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<DownloadsData>({ connection: 'loading', engine: null, error: null })
  const [settings, setSettings] = useState<DesktopSettings | null>(null)
  const [adding, setAdding] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DownloadItem | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)

  useTheme(theme)

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
    if (isDesktopRuntime()) void loadDesktopSettings().then(setSettings).catch(() => {})
    const timer = isDesktopRuntime() ? window.setInterval(() => void refresh(), 1000) : undefined
    return () => {
      controller.abort()
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
      if (isDesktopRuntime() && !preview) setAddOpen(true)
      } else if (event.key === '/' && !editing) {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'Escape') {
        setQuery('')
        setAddOpen(false)
        setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  useEffect(() => { mainRef.current?.focus() }, [route])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const allItems = preview ? previewDownloads : data.engine?.downloads ?? EMPTY_DOWNLOADS
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems
    const needle = query.trim().toLowerCase()
    return allItems.filter((item) => item.name.toLowerCase().includes(needle) || item.url.toLowerCase().includes(needle))
  }, [allItems, query])

  const items = useMemo(() => {
    switch (route) {
      case 'active': return filteredItems.filter((item) => item.status === 'active')
      case 'paused': return filteredItems.filter((item) => ['paused', 'interrupted', 'failed'].includes(item.status))
      case 'completed': return filteredItems.filter((item) => item.status === 'completed')
      case 'queue': return filteredItems.filter((item) => item.status === 'queued')
      case 'video': return filteredItems.filter((item) => item.category === 'video')
      case 'history': return filteredItems.filter((item) => ['completed', 'paused', 'interrupted', 'failed', 'cancelled'].includes(item.status))
      case 'dashboard': return [...filteredItems].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 6)
      default: return filteredItems
    }
  }, [filteredItems, route])

  const activeItem = selected
    ? (allItems.find((item) => item.id === selected.id) ?? selected)
    : null

  function notify(text: string, kind: 'success' | 'error' = 'success') {
    setToast({ text, kind })
  }

  async function addDownload(url: string, options: AddDownloadOptions) {
    setAdding(true)
    setActionError(null)
    try {
      await startDesktopDownload(url, options)
      setAddOpen(false)
      const destination = options.startImmediately ? 'active' : 'queue'
      setRoute(destination)
      window.location.hash = `#/${destination}`
      setData(await loadEngineState())
      notify(options.startImmediately ? 'Download added to the engine.' : 'Download placed in the queue.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setActionError(message)
      setToast({ text: message, kind: 'error' })
    } finally {
      setAdding(false)
    }
  }

  async function runAction(action: () => Promise<unknown>, successText?: string) {
    try {
      setActionError(null)
      await action()
      setData(await loadEngineState())
      if (successText) notify(successText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setActionError(message)
      setToast({ text: message, kind: 'error' })
    }
  }

  async function clearHistory() {
    await runAction(() => clearDesktopHistory(), 'Non-resumable history cleared.')
  }

  const title = TITLES[route]
  const connectedText = preview ? 'Preview' : data.connection === 'connected' ? 'Engine online' : data.connection === 'loading' ? 'Connecting…' : 'Engine offline'
  const themeIcon: IconName = theme === 'system' ? 'system' : theme === 'dark' ? 'moon' : 'sun'
  const pages = {
    items,
    connection: preview ? 'preview' : data.connection,
    error: data.error,
    preview,
    onTogglePreview: () => setPreview((value) => !value),
    onResumeDownload: isDesktopRuntime() && !preview ? (id: string) => runAction(() => resumeDesktopDownload(id)) : undefined,
    onPauseDownload: isDesktopRuntime() && !preview ? (id: string) => runAction(() => pauseDesktopDownload(id), 'Pause requested.') : undefined,
    onCancelDownload: isDesktopRuntime() && !preview ? (id: string) => runAction(() => cancelDesktopDownload(id), 'Download cancelled.') : undefined,
    onStartQueuedDownload: isDesktopRuntime() && !preview ? (id: string) => runAction(() => startQueuedDesktopDownload(id), 'Queued download started.') : undefined,
    onOpenDetails: (item: DownloadItem) => setSelected(item),
    onOpenFile: isDesktopRuntime() && !preview ? (id: string) => runAction(() => openDownloadedFile(id)) : undefined,
    onOpenFolder: isDesktopRuntime() && !preview ? (id: string) => runAction(() => openContainingFolder(id)) : undefined,
    onClearHistory: isDesktopRuntime() && !preview ? clearHistory : undefined,
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <aside className="sidebar" aria-label="Application navigation">
          <a className="brand-row" href="#/dashboard" aria-label="ZEX Download Manager home">
            <span className="brand-mark"><span>Z</span><i /></span>
            <span className="brand-wordmark"><span className="brand-name">ZEX</span><span className="brand-edition">DOWNLOAD MANAGER</span></span>
          </a>
          {['Workspace', 'Organize', 'Library', 'Preferences'].map((section) => {
            const sectionItems = NAVIGATION.filter((item) => item.section === section)
            if (!sectionItems.length) return null
            return (
              <div className="nav-group" key={section}>
                <div className="sidebar-section">{section}</div>
                <nav className="sidebar-nav">
                  {sectionItems.map((item) => (
                    <a key={item.slug} href={`#/${item.slug}`} className="nav-item interactive" aria-label={item.accessibleName} aria-current={route === item.slug ? 'page' : undefined}>
                      <Icon name={item.icon} size={17} /><span className="nav-item-label">{item.label}</span>
                      {item.slug === 'queue' && allItems.filter((download) => download.status === 'queued').length > 0 && (
                        <span className="nav-count">{allItems.filter((download) => download.status === 'queued').length}</span>
                      )}
                    </a>
                  ))}
                </nav>
              </div>
            )
          })}
          <div className="sidebar-spacer" />
          <a href="#/stats" className="nav-item interactive" aria-current={route === 'stats' ? 'page' : undefined}><Icon name="activity" size={17} /><span className="nav-item-label">Performance</span></a>
          <div className="sidebar-divider" />
          <div className="sidebar-footer">
            <div className="engine-state"><span className={`engine-state-dot ${data.connection}`} /><span className="sidebar-footer-copy">{connectedText}</span></div>
            <button type="button" className="nav-item theme-nav-button interactive" aria-label={`Theme: ${theme}`} onClick={() => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system')}>
              <Icon name={themeIcon} size={16} /><span className="nav-item-label">{theme === 'system' ? 'System theme' : `${theme[0].toUpperCase()}${theme.slice(1)} theme`}</span>
            </button>
          </div>
        </aside>

        <div className="main-column">
          <header className="topbar">
            <div className="topbar-heading">
              <h1 className="topbar-title">{title.title}</h1>
              <p className="topbar-subtitle">{title.subtitle}</p>
            </div>
            <div className="topbar-actions">
              {(route === 'all' || route === 'active' || route === 'paused' || route === 'completed' || route === 'history') && (
                <label className="search-field" htmlFor="global-search">
                  <Icon name="search" size={16} />
                  <input id="global-search" ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search downloads" />
                  <span className="shortcut-key">Ctrl K</span>
                </label>
              )}
              {isDesktopRuntime() && <Button variant="primary" icon="plus" onClick={() => { setActionError(null); setAddOpen(true) }}>Add download</Button>}
              <IconButton icon={themeIcon} label={`Theme: ${theme}`} onClick={() => setTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system')} />
            </div>
          </header>

          <main id="main" ref={mainRef} tabIndex={-1} className="page-content">
            {route === 'dashboard' && <Dashboard {...pages} items={allItems} />}
            {route === 'all' && <AllDownloads {...pages} />}
            {route === 'active' && <ActiveDownloads {...pages} />}
            {route === 'paused' && <PausedDownloads {...pages} />}
            {route === 'completed' && <CompletedDownloads {...pages} />}
            {route === 'video' && <VideoDownloads {...pages} />}
            {route === 'queue' && <DownloadQueue {...pages} />}
            {route === 'scheduler' && <Scheduler {...pages} />}
            {route === 'browser' && <BrowserIntegration {...pages} />}
            {route === 'history' && <DownloadHistory {...pages} />}
            {route === 'settings' && <Settings {...pages} theme={theme} onThemeChange={setTheme} settings={settings} onSettingsSaved={(value) => setSettings(value)} />}
            {route === 'stats' && <PerformanceStatistics {...pages} items={allItems} />}
          </main>
          <footer className="app-footer"><span><span className={`engine-state-dot ${data.connection}`} />{connectedText}</span><span><Icon name="zap" size={13} />Rust transfer engine</span><span>v0.2 · {isDesktopRuntime() ? 'Desktop' : 'Read-only preview'}</span></footer>
        </div>
      </div>

      {addOpen && <AddDownloadDialog open={addOpen} onClose={() => setAddOpen(false)} onSubmit={addDownload} busy={adding} error={actionError} defaultFolder={settings?.downloadDirectory ?? ''} />}
      <DownloadDetailsDialog
        item={activeItem}
        onClose={() => setSelected(null)}
        onResume={pages.onResumeDownload}
        onPause={pages.onPauseDownload}
        onCancel={pages.onCancelDownload}
        onOpenFile={pages.onOpenFile}
        onOpenFolder={pages.onOpenFolder}
      />
      {toast && <div className="toast-stack"><div role={toast.kind === 'error' ? 'alert' : 'status'} className={`toast ${toast.kind === 'error' ? 'toast-error' : 'toast-success'}`}><Icon name={toast.kind === 'error' ? 'warning' : 'check'} size={17} /><span className="toast-message">{toast.text}</span><button type="button" className="toast-dismiss" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button></div></div>}
    </div>
  )
}

function AllDownloads(props: PageProps) {
  return <><PageHeader title="All downloads" description="Every file tracked by the local transfer engine." /><DownloadTable {...props} items={props.items} /></>
}

function PausedDownloads(props: PageProps) {
  return <><PageHeader title="Paused & interrupted" description="Resume downloads only when their partial file and checkpoint are both valid." /><DownloadTable {...props} items={props.items.filter((item) => ['paused', 'interrupted', 'failed'].includes(item.status))} /></>
}
