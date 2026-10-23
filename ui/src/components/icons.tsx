import type { SVGProps } from 'react'

export type IconName =
  | 'activity' | 'archive' | 'arrow-down' | 'arrow-up' | 'browser' | 'calendar'
  | 'check' | 'chevron-down' | 'chevron-left' | 'chevron-right' | 'clock' | 'close'
  | 'cloud-download' | 'document' | 'download' | 'external' | 'file' | 'filter'
  | 'folder' | 'grid' | 'history' | 'home' | 'image' | 'info' | 'link' | 'list' | 'loader'
  | 'moon' | 'more' | 'music' | 'pause' | 'play' | 'plus' | 'refresh' | 'search'
  | 'settings' | 'sparkles' | 'sun' | 'system' | 'trash' | 'video' | 'warning' | 'zap'

const paths: Record<IconName, string> = {
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  archive: 'M4 4h16v4H4z M5 8v12h14V8 M10 12h4',
  'arrow-down': 'M12 4v12m0 0 5-5m-5 5-5-5 M5 20h14',
  'arrow-up': 'M12 20V8m0 0 5 5m-5-5-5 5 M5 4h14',
  browser: 'M4 5h16v14H4z M4 9h16 M8 7h.01 M11 7h.01',
  calendar: 'M5 4v3m14-3v3M4 8h16v12H4z M8 12h3v3H8z',
  check: 'm5 12 4 4L19 6',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-left': 'm14 18-6-6 6-6',
  'chevron-right': 'm10 18 6-6-6-6',
  clock: 'M12 8v4l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  close: 'm6 6 12 12M18 6 6 18',
  'cloud-download': 'M8 18H6a4 4 0 1 1 .6-7.95A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9h-2m-4-8v9m0 0 3-3m-3 3-3-3',
  document: 'M7 3h7l5 5v13H7z M14 3v6h5 M10 13h6m-6 4h6',
  download: 'M12 3v12m0 0 5-5m-5 5-5-5 M4 19v2h16v-2',
  external: 'M13 5h6v6m0-6-9 9 M18 13v6H5V6h6',
  file: 'M6 3h8l4 4v14H6z M14 3v5h5 M9 13h6m-6 4h6',
  filter: 'M4 5h16l-6 7v6l-4 2v-8z',
  folder: 'M3 6h7l2 2h9v11H3z',
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  history: 'M3 12a9 9 0 1 0 2.6-6.4L3 8m0-5v5h5m4-1v5l3 2',
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z',
  image: 'M4 4h16v16H4z M8 10h.01 M20 15l-5-5L5 20',
  info: 'M12 11v5m0-8h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  link: 'M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.71m2.72 6.36a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.71-1.72',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  loader: 'M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-6.36-2.12 2.12M7.76 16.24l-2.12 2.12m12.72 0-2.12-2.12M7.76 7.76 5.64 5.64',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  music: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Zm12-2a3 3 0 1 1-3-3c1.66 0 3 1.34 3 3Z',
  pause: 'M8 5v14m8-14v14',
  play: 'm8 5 12 7-12 7z',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 9a7 7 0 0 1 12-2l2 2M4 15l2 2a7 7 0 0 0 12-2',
  search: 'm20 20-4.5-4.5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.09-.02a1.7 1.7 0 0 0-1.72.45l-.06.06h-3.4l-.06-.08a1.7 1.7 0 0 0-1.65-.58l-.09.02-1.7-2.94.06-.06a1.7 1.7 0 0 0 .34-1.88l-.04-.09-2.94-1.7.02-.09a1.7 1.7 0 0 0-.45-1.72l-.06-.06V8.4l.08-.06a1.7 1.7 0 0 0 .58-1.65l-.02-.09 2.94-1.7.06.06a1.7 1.7 0 0 0 1.88.34l.09-.04 1.7-2.94.09.02a1.7 1.7 0 0 0 1.72-.45l.06-.06h3.4l.06.08a1.7 1.7 0 0 0 1.65.58l.09-.02 1.7 2.94-.06.06a1.7 1.7 0 0 0-.34 1.88l.04.09 2.94 1.7-.02.09a1.7 1.7 0 0 0 .45 1.72l.06.06v3.4l-.08.06a1.7 1.7 0 0 0-.58 1.65z',
  sparkles: 'm12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4z M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41',
  system: 'M3 5h18v12H3z M8 21h8m-4-4v4',
  trash: 'M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3',
  video: 'M4 6h11v12H4z M15 10l5-3v10l-5-3z',
  warning: 'M12 3 2.8 19h18.4L12 3Zm0 6v5m0 3h.01',
  zap: 'm13 2-3 8H5l6 12 3-8h5z',
}

export function Icon({ name, size = 18, strokeWidth = 1.8, ...props }: SVGProps<SVGSVGElement> & {
  name: IconName
  size?: number
  strokeWidth?: number
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  )
}
