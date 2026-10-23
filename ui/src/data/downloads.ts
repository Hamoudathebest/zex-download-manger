import { invoke } from '@tauri-apps/api/core'

/**
 * Downloads data layer. Desktop state comes from the Tauri backend; the
 * standalone web preview only accepts a real engine-state endpoint.
 *
 * Source (a): a REAL engine checkpoint/queue file, if one is present.
 *   The web preview fetches the optional `/engine-state.json` endpoint.
 *   A missing endpoint stays explicitly disconnected.
 *
 * Source (b): EXPLICIT DISCONNECTED / EMPTY state.
 *   When the fetch fails, every page shows an empty list and a
 *   disconnected banner. Nothing is invented:
 *   no speeds, no progress percentages, no download counts are
 *   presented as real.
 *
 * The optional static UI preview (see preview.ts) is a SEPARATE,
 * opt-in, clearly-labelled mode. It is never the default and its
 * rows are always badged PREVIEW. It exists only so reviewers can
 * see table/chart layouts without a live engine.
 */

export type DownloadStatus =
  | 'active'
  | 'paused'
  | 'queued'
  | 'completed'
  | 'failed'
  | 'scheduled'
  | 'interrupted'
  | 'cancelled'

export type DownloadCategory = 'file' | 'video' | 'other'

export interface DownloadItem {
  id: string
  name: string
  url: string
  sizeBytes: number | null
  downloadedBytes: number | null
  /** Bytes/sec, ONLY when reported by the real engine. Null = unknown. */
  speedBytesPerSec: number | null
  status: DownloadStatus
  category: DownloadCategory
  addedAt: string
  /** 0–100, ONLY when reported by the real engine. Null = unknown. */
  progressPercent: number | null
  destination?: string
  error?: string | null
  etaSeconds?: number | null
  resumable?: boolean
  startManually?: boolean
}

export type ConnectionState = 'loading' | 'connected' | 'disconnected'

export interface EngineState {
  generatedAt: string
  downloads: DownloadItem[]
}

export interface DownloadsData {
  connection: ConnectionState
  /** Null when disconnected — callers must render the empty state. */
  engine: EngineState | null
  error: string | null
}

export interface DesktopSettings {
  downloadDirectory: string
  connections: number
  maxConcurrentDownloads: number
  throttleBytesPerSec: number
  maxRetries: number
}

/** URL the real engine is expected to publish. Override with VITE_ENGINE_STATE_URL. */
export const ENGINE_STATE_URL =
  import.meta.env.VITE_ENGINE_STATE_URL ?? '/engine-state.json'

export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && Reflect.has(window, '__TAURI_INTERNALS__')
}

export async function loadEngineState(signal?: AbortSignal): Promise<DownloadsData> {
  if (isDesktopRuntime()) {
    try {
      const engine = await invoke<EngineState>('list_downloads')
      return { connection: 'connected', engine, error: null }
    } catch (err) {
      if (signal?.aborted) return { connection: 'loading', engine: null, error: null }
      return {
        connection: 'disconnected',
        engine: null,
        error: err instanceof Error ? err.message : 'Desktop download service is unavailable.',
      }
    }
  }

  try {
    const res = await fetch(ENGINE_STATE_URL, { signal })
    if (!res.ok) {
      return {
        connection: 'disconnected',
        engine: null,
        error: `Engine state not available (HTTP ${res.status} from ${ENGINE_STATE_URL}). Phase 1 has no live engine connection.`,
      }
    }
    const parsed = (await res.json()) as EngineState
    if (!parsed || !Array.isArray(parsed.downloads)) {
      return {
        connection: 'disconnected',
        engine: null,
        error: 'Engine state file was present but did not match the documented shape. Treated as disconnected rather than guessing.',
      }
    }
    return { connection: 'connected', engine: parsed, error: null }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { connection: 'loading', engine: null, error: null }
    }
    return {
      connection: 'disconnected',
      engine: null,
      error: `Could not reach the engine state file (${ENGINE_STATE_URL}). This is the expected Phase 1 state: no live metrics are connected.`,
    }
  }
}

export async function startDesktopDownload(
  url: string,
  options: {
    filename?: string
    destinationDirectory?: string
    category?: DownloadCategory
    startImmediately?: boolean
  } = {},
): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Adding downloads requires the ZEX desktop application.')
  await invoke('start_download', { url, ...options })
}

export async function startQueuedDesktopDownload(id: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Starting queued downloads requires the ZEX desktop application.')
  await invoke('start_queued_download', { id })
}

export async function resumeDesktopDownload(id: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Resuming downloads requires the ZEX desktop application.')
  await invoke('resume_download', { id })
}

export async function pauseDesktopDownload(id: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Pause is available only in the ZEX desktop application.')
  await invoke('pause_download', { id })
}

export async function cancelDesktopDownload(id: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Cancel is available only in the ZEX desktop application.')
  await invoke('cancel_download', { id })
}

export async function loadDesktopSettings(): Promise<DesktopSettings> {
  if (!isDesktopRuntime()) throw new Error('Settings are available only in the ZEX desktop application.')
  return invoke<DesktopSettings>('get_settings')
}

export async function saveDesktopSettings(settings: DesktopSettings): Promise<DesktopSettings> {
  if (!isDesktopRuntime()) throw new Error('Settings are available only in the ZEX desktop application.')
  return invoke<DesktopSettings>('save_settings', { settings })
}

export async function clearDesktopHistory(): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Download history is available only in the ZEX desktop application.')
  await invoke('clear_history')
}

export async function openDownloadedFile(id: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Opening downloads requires the ZEX desktop application.')
  await invoke('open_download_file', { id })
}

export async function openContainingFolder(id: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('Opening download folders requires the ZEX desktop application.')
  await invoke('open_download_folder', { id })
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return '—'
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${remaining}s`
  return `${remaining}s`
}
