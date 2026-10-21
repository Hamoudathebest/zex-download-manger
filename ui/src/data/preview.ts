/**
 * STATIC UI PREVIEW DATA — NOT LIVE, NOT MEASURED, NOT REAL DOWNLOADS.
 *
 * Purpose: let a reviewer see table/chart layouts without an engine.
 * Every surface that renders this data MUST badge it "PREVIEW" and
 * carry the note "Static placeholder values — not live activity."
 * Never present these numbers as speeds, progress, or history of
 * real downloads. The default app state does NOT use this file.
 */
import type { DownloadItem } from './downloads'

export const PREVIEW_NOTICE =
  'Static UI preview — placeholder values only. Not live downloads, speeds, or progress.'

export const previewDownloads: DownloadItem[] = [
  {
    id: 'preview-1',
    name: 'preview-example-document.pdf',
    url: 'https://example.invalid/files/preview-example-document.pdf',
    sizeBytes: 12_400_000,
    downloadedBytes: 6_200_000,
    speedBytesPerSec: null, // Deliberately null: even preview rows do not fake a live speed.
    status: 'paused',
    category: 'file',
    addedAt: '2026-10-21T10:00:00Z',
    progressPercent: 50,
  },
  {
    id: 'preview-2',
    name: 'preview-example-video.mp4',
    url: 'https://example.invalid/files/preview-example-video.mp4',
    sizeBytes: 240_000_000,
    downloadedBytes: 240_000_000,
    speedBytesPerSec: null,
    status: 'completed',
    category: 'video',
    addedAt: '2026-10-20T10:00:00Z',
    progressPercent: 100,
  },
]
