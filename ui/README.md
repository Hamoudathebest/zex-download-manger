# Download Manager — Desktop UI/UX Prototype (Phase 1)

React 19 + TypeScript + Vite + Tailwind CSS (v4, via `@tailwindcss/vite`).
Hash-routed, no router dependency. Minimal dependencies on purpose.

## What this is — and is not

**This is a web prototype of the desktop UI.** It runs in a browser with
`npm run dev` / `npm run preview`. It renders layout, navigation, themes,
and empty / disconnected states for all 10 pages.

**This is NOT a desktop app.** There is no Tauri shell, no native window,
no system tray, no Windows installer, and no browser extension in this
folder. Tauri / Windows packaging was **not built or verified here**
(Linux VM, no Windows machine) and is explicitly **Phase 2**.

**This is NOT a working downloader.** It starts, pauses, resumes, or
schedules nothing. Download action buttons are disabled and labelled as
such. No DRM circumvention is implemented or implied anywhere.

## Run it (exact commands)

```bash
cd ~/workspace/download-manager/ui
npm install   # only needed once; dependencies are already installed in this VM
npm run dev   # → http://localhost:5173 (Vite dev server)
```

Production build + local preview:

```bash
npm run build    # tsc -b && vite build
npm run preview  # serves dist/ locally
```

No fallback was needed: `npm install` and the Vite build succeeded on
this Linux VM (Node 24). See "Validation" below for the actual result.

## Pages / routes (10, hash-routed)

| Route | Page |
|---|---|
| `#/dashboard` | Dashboard |
| `#/active` | Active Downloads |
| `#/completed` | Completed Downloads |
| `#/video` | Video Downloads |
| `#/queue` | Download Queue |
| `#/scheduler` | Scheduler |
| `#/browser` | Browser Integration |
| `#/history` | Download History |
| `#/settings` | Settings |
| `#/stats` | Performance Statistics |

## How metrics are handled — read this before trusting any number

**Default state: DISCONNECTED / EMPTY.** On load the app fetches
`/engine-state.json` (same origin; overridable via `VITE_ENGINE_STATE_URL`).
No such file exists in Phase 1, so the fetch 404s and every page shows:

- an amber "Not connected to the download engine (Phase 1)" banner,
- empty tables, and `—` wherever a speed, size, or percentage would go.

**No live speed, progress bar, or download count is ever invented.**
`formatSpeed(null)` and `formatBytes(null)` render `—`. The statistics
page draws **no speed-over-time chart** from invented data — it shows a
labelled "No data" placeholder instead.

**Connecting real data (engine team's job, Phase 1/2):** publish a JSON
file at `public/engine-state.json` (dev) or at the web root (deployed)
matching `public/engine-state.example.json`:

```json
{ "generatedAt": "…", "downloads": [ { "id", "name", "url",
  "sizeBytes", "downloadedBytes", "speedBytesPerSec",
  "status": "active|paused|queued|completed|failed|scheduled",
  "category": "file|video|other", "addedAt", "progressPercent" } ] }
```

Only values present in that file are rendered. A malformed file is
treated as disconnected, never guessed at.

**Labelled UI preview (opt-in only, never the default):** the banner
button "Show labelled UI preview" loads two static rows from
`src/data/preview.ts`. Every preview row is badged **PREVIEW** and the
banner states the values are placeholders, not live activity. Even
preview rows deliberately carry `speedBytesPerSec: null` — the preview
fakes no live speed. Toggle it off to return to the disconnected state.

## Themes, layout, accessibility

- **Dark / light themes:** toggle in the sidebar; persisted in
  `localStorage` (`dm-theme`); first visit follows `prefers-color-scheme`.
  Implemented with Tailwind v4's `@custom-variant dark` (`.dark` class).
- **Responsive desktop layout:** sidebar is a top nav on narrow screens
  and a fixed 256 px sidebar on `md:` and up; tables scroll horizontally
  rather than breaking layout.
- **Keyboard navigation basics:** skip link to `#main`, all nav items are
  real links with `aria-current="page"`, visible `:focus-visible` rings,
  `/` focuses the search box, `Tab`/`Shift+Tab` + `Enter`/`Space` work
  throughout. Focus moves to `<main>` on route change.
- **Accessible labels:** tables have `<caption>` (visually hidden),
  `scope="col"`, and labelled `role="progressbar"` elements; forms have
  real `<label>`s; status banners use `role="status"` / `aria-live`;
  decorative elements are hidden from assistive tech.
- **Reduced motion:** CSS honours `prefers-reduced-motion: reduce`.
- **Known accessibility gap (honest):** colour contrast has not been
  formally audited with a checker — verify before release, especially
  the amber disconnected banner in both themes.

## File map

- `src/App.tsx` — hash routing, theme state, engine-state loading, layout.
- `src/data/downloads.ts` — data layer + honesty contract (see its header).
- `src/data/preview.ts` — static, labelled preview rows only.
- `src/components/ui.tsx` — banner, tables, stat cards, empty states.
- `src/pages/*.tsx` — the 10 pages. `Settings.tsx` preferences are
  browser-local only and do not configure any engine.
- `public/engine-state.example.json` — documented engine-state shape.

## Validation

Run on this VM (Node v24.20.0, npm 10.9.4) — see the agent report for
the exact outcome. If `npm run build` ever fails in your environment,
do not claim it passed: paste the error and treat the prototype as
unvalidated.
