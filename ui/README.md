# ZEX Download Manager — UI and Tauri desktop shell

React 19 + TypeScript + Vite + Tailwind CSS (v4, via `@tailwindcss/vite`).
Hash-routed, no router dependency. Minimal dependencies on purpose.

## Current implementation status

The React interface runs as a Vite web preview and is also embedded in a
Tauri 2 desktop application (`src-tauri/`). In the desktop build, **Add
download** starts the real Rust `dm` engine, the UI polls actual progress,
and job records persist in the app-data directory. Jobs submitted through
the Chromium Native Messaging host share that state file.

The Tauri shell, NSIS bundle, and install/start smoke test passed on the
GitHub `windows-latest` runner. This is runner validation, not a claim of
Windows 10/11 user-machine or interactive browser compatibility.

Checkpointed interrupted/failed downloads can be resumed from Active
Downloads, including after restart. Live speed/ETA, settings, history and a
configurable concurrency queue are connected to desktop state. Pause/cancel
pass Linux and Windows engine tests. New Playwright/CDP Windows UI and
Chromium Native Messaging end-to-end tests are pending their first CI run;
manual Windows interaction remains distinct. Queue priority/reordering and
scheduler are not implemented. DRM circumvention is not implemented.

## Run it (exact commands)

```bash
npm ci
npm run dev       # web preview at http://localhost:5173
```

Build the Windows desktop application from a Windows environment with the
Rust MSVC toolchain and WebView2 available:

```bash
npm ci
cargo build --release --manifest-path ../engine/Cargo.toml
npm run tauri:dev
npm run tauri:build  # builds the app and NSIS installer
```

`tauri:build` regenerates icons, builds the frontend, and bundles the Rust
engine plus Native Messaging host. The current Linux VPS can run the Vite
preview and Rust tests; the product installer/startup test runs on the
Windows Actions runner.

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

**Web preview:** fetches `/engine-state.json` (same origin; overridable via
`VITE_ENGINE_STATE_URL`). If no live state endpoint is configured, it stays
disconnected and shows no invented download values.

**Tauri desktop:** calls the Rust backend for persisted download records.
Progress values are updated from the real CLI progress stream; unavailable
values stay null/blank. The state file is shared with the Native Messaging
host so browser-submitted jobs appear in the desktop view.


**No live speed, progress bar, or download count is ever invented.**
`formatSpeed(null)` and `formatBytes(null)` render `—`. The statistics
page draws **no speed-over-time chart** from invented data — it shows a
labelled "No data" placeholder instead.

The web preview endpoint shape remains documented in
`public/engine-state.example.json`:

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
- `src-tauri/` — Tauri backend, per-user state persistence, CLI launch,
  Windows NSIS configuration and browser Native Messaging registration.
- `src/pages/*.tsx` — the 10 pages. `Settings.tsx` preferences are
  browser-local only and do not configure any engine.
- `public/engine-state.example.json` — documented engine-state shape.

## Validation

On the current Linux VPS, `npm run lint`, `npm run build`, Tauri backend
`cargo fmt`/Clippy/tests/build, and `npm run tauri:icons` passed. See the
root `TEST_REPORT.md` for dated results. Windows NSIS installation/startup
and live browser pairing remain pending Windows Actions evidence.
