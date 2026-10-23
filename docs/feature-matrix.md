# Feature Matrix — IDM vs Planned Implementation

> **Explicit disclaimer — read first:**
>
> **IDM was NOT tested here. No IDM binary was available, downloaded,
> installed, run, decompiled, or analysed in any way in this
> environment.** No reverse engineering was performed, and none is
> claimed.
>
> The IDM column below is based **only** on public IDM documentation
> and widely described public behaviour of Internet Download Manager
> (tonec.com / IDM's public feature pages and help material, as
> generally described). Where a public-doc claim could not be checked
> against a source from this environment, the row is marked
> `not-verified` rather than asserted.
>
> The "Planned implementation" column describes **this project's
> design intent** (see `architecture.md`). `planned` does **not**
> mean built, tested, or shipped. Phase 1 is a Linux prototype; most
> planned rows are not yet implemented, and none have Windows test
> evidence.

## How to read the labels

Every row carries a label in the **Basis** column. The label applies
to the IDM claim on that row unless the row text says otherwise:

| Label | Meaning |
|---|---|
| `public-doc` | The IDM behaviour is described in IDM's public documentation / public feature descriptions. This is a summary of public material, not a test result. |
| `planned` | This project's intended behaviour, from `architecture.md`. Not built/tested unless the row says otherwise. |
| `not-verified` | Could not be confirmed from this environment (no binary, no Windows machine, no access to the cited source in this session). Do not treat as fact. |
| `not-run` | A performance / measurement claim that has not been measured. No number is given for such rows. |

**Status vocabulary for the planned column:**

- `Phase 1 — spec'd` = designed in `architecture.md`, not yet built.
- `Phase 1 — prototype` = intended to be exercised by the Linux prototype.
- `Phase 2 — planned` = requires Tauri / Windows work; not in Phase 1.
- `Phase 3 — planned` = polish / release work; not in Phase 1 or 2.
- `Out of scope` = deliberately not built (with reason).

**A note on fairness:** IDM is a mature, commercial, Windows-only
product with decades of development. This project is a Phase 1
foundation on Linux. The matrix is not a "we match IDM" claim — it is
a gap map: what IDM publicly offers, what this project intends to
offer, and how far apart those are today. Any row where the planned
column says "Phase 2/3" is a gap in Phase 1, stated plainly.

---

## 1. Core downloading

| # | Feature | IDM (public description) | Planned implementation | Basis / planned status |
|---|---|---|---|---|
| 1.1 | Multi-connection / segmented download (split a file into parts downloaded in parallel) | IDM publicly describes dynamic file segmentation / multipart downloading to accelerate downloads. | Segmented range downloads, default 8 connections, 1–32 configurable, with single-connection fallback when the server lacks range support (`architecture.md` §4.3). | `public-doc` / `planned` — Phase 1 prototype |
| 1.2 | Dynamic segmentation / re-splitting mid-download | IDM publicly describes dynamic segmentation that adjusts during download. The exact algorithm is proprietary and not described in public docs in implementable detail. | Phase 1: fixed equal-size segments, no re-splitting, no segment stealing. Dynamic re-splitting is an open decision (D-07) for Phase 2, pending measurement. | `public-doc` (existence) + `not-verified` (algorithm detail) / `planned` — Phase 1 gap, stated |
| 1.3 | Resume / restart of interrupted downloads | IDM publicly describes resume capability for interrupted downloads. | Checkpointed resume across pause and app restart (`.part` + checkpoint JSON, `architecture.md` §4, §9). Resume re-probes and validates ETag/length before continuing. Crash-kill recovery tests remain open. | `public-doc` / `implemented-partial` — Linux-tested; Windows UI E2E attach issue being fixed |
| 1.4 | Speed limiting (per-download and global) | IDM publicly offers download speed limiting / bandwidth allocation controls. | Configurable per-download token bucket; with concurrent downloads the configured cap applies to each engine process, not as one global aggregate cap (`architecture.md` §4.7). | `public-doc` / `implemented-partial` — desktop setting passes the value to `dm` |
| 1.5 | Download categories with default folders | IDM publicly offers categories (e.g. music, video, documents) with assigned folders. | Categories as labels + default folders, user-editable; categories are not separate queues (`architecture.md` §8.1). | `public-doc` / `planned` — Phase 1 prototype |
| 1.6 | Queue management (ordering, priorities) | IDM publicly offers a download queue with scheduling/ordering. | Single insertion-ordered queue with configurable concurrent slots. Priority and user reordering remain open (`architecture.md` §8.1). | `public-doc` / `implemented-partial` — Linux-tested; Windows E2E blocked on WebView2 attach |
| 1.7 | Scheduled downloads (time windows) | IDM publicly offers a scheduler for downloads at set times. | Weekly scheduling windows + one-shot schedules; `pause` / `finish-current` / `continue` on window end (`architecture.md` §8.2). | `public-doc` / `planned` — Phase 1 prototype |
| 1.8 | Browser integration (capture downloads from the browser) | IDM publicly describes browser integration for major browsers, capturing downloads / video. | MV3 extension + Native Messaging host; user-initiated handoff only, minimal permissions, no traffic interception in Phase 1 (`architecture.md` §5). | `public-doc` / `implemented-partial` — Linux host tests pass; Windows browser E2E blocked on WebView2 attach |
| 1.9 | Support for HTTP/HTTPS, proxies, authentication | IDM publicly supports HTTP/HTTPS, proxy servers, and site login / authentication flows. | HTTP(S) only in Phase 1. Proxy support: via standard env / HTTP client proxy config, to be specified in Phase 1 implementation (not yet detailed in architecture). Site-login / cookie-based auth flows: **out of scope** — this tool does not harvest browser sessions (§12). HTTP Basic auth via user-supplied credentials in URL is rejected by default (D-09). | `public-doc` / `planned` (HTTP/S) + `not-verified` (proxy details) + out-of-scope (session harvesting) |
| 1.10 | FTP support | IDM publicly lists FTP among supported protocols (legacy feature). | Out of scope for Phase 1. HTTP(S) only. FTP may be reconsidered in Phase 2 if a real user need is shown; no commitment. | `public-doc` / out of scope (Phase 1) |
| 1.11 | Download acceleration claims (e.g. "up to 5x faster") | IDM's marketing publicly claims acceleration multiples. Such multiples depend on server, connection, and file, and cannot be verified without testing. | **No acceleration multiple is claimed.** Any future speed claim must be a real measured result (method + hardware + date) or labelled `not-run`. Segmented downloading may help on range-supporting servers with spare bandwidth; it may not help on throttled or single-connection servers. | `public-doc` (marketing claim exists) / `not-run` (this project claims nothing) |
| 1.12 | Integrity verification (size / hash) | IDM publicly describes download integrity handling; specific hash-verification UI is not documented in the public summaries relied on here. | Size check always; SHA-256 hash check when user/server supplies a hash; failure keeps `.part` for diagnosis (`architecture.md` §4.5). | `not-verified` (IDM detail) / `planned` — Phase 1 prototype |
| 1.13 | File-name handling on collision | IDM publicly offers automatic file naming / renaming behaviour. Exact rules vary by version and were not verified here. | Sanitisation + ` (n)` suffix before extension on collision; no silent overwrite on completion rename (`architecture.md` §4.2, §4.5). | `not-verified` (IDM detail) / `planned` |
| 1.14 | Pause all / resume all | IDM publicly offers pause/resume controls. | Pause/resume per job and (via scheduler window end) globally; "pause all" as a UI action maps to pausing each active job (`architecture.md` §8.3). | `public-doc` / `planned` |

## 2. Media / video downloading

| # | Feature | IDM (public description) | Planned implementation | Basis / planned status |
|---|---|---|---|---|
| 2.1 | Video download from web pages (download panel / button on video pages) | IDM publicly describes a video download panel that appears on video pages in supported browsers. | Extension media click (user right-clicks a `<video>`/`<audio>` element) + pasted playlist URL. No automatic panel injected into every video page in Phase 1. | `public-doc` / `planned` — Phase 1 gap vs IDM panel UX, stated |
| 2.2 | HLS / DASH stream download | IDM publicly describes downloading streaming video. Which protocols/DRM variants it handles is version- and site-dependent and was not verified here. | Unencrypted HLS (TS concat) + unencrypted DASH segment download only. Any encryption → hard stop with `MEDIA_ENCRYPTED` (`architecture.md` §6.3–6.4). Live (sliding-window) playlists unsupported in Phase 1. | `not-verified` (IDM protocol detail) / `planned` — Phase 1 prototype, deliberately narrower than IDM's public claim |
| 2.3 | Quality selection for video | IDM publicly offers quality/format choice for video downloads where available. | Master-playlist variant listing; user picks, CLI defaults to highest-bandwidth unencrypted variant; choice recorded in job record (`architecture.md` §6.3). | `public-doc` / `planned` |
| 2.4 | DRM-protected content | IDM's public material does not present DRM circumvention as a feature; handling of DRM sites is site-dependent and not verified here. | **Out of scope, by policy.** Widevine/FairPlay/PlayReady, HLS AES-128 keys, and DASH ContentProtection all stop the job. No licence requests, no key extraction, no decryption (`architecture.md` §6.4). | `not-verified` (IDM detail) / out of scope (deliberate) |
| 2.5 | Audio / video conversion / remuxing | IDM publicly offers format handling for downloaded media in some flows; specifics were not verified here. | Phase 1: direct files + TS concatenation only. fMP4 remux via ffmpeg is Phase 2 `planned`, pending ffmpeg availability + correctness verification (D-10). No transcoding promise in Phase 1. | `not-verified` / `planned` (Phase 2) |

## 3. Browser integration

| # | Feature | IDM (public description) | Planned implementation | Basis / planned status |
|---|---|---|---|---|
| 3.1 | Chrome / Edge / Firefox integration | IDM publicly lists integration with major browsers via extension/module. | Phase 1: Chromium MV3 prototype (Linux). Firefox: Phase 2 assessment. Edge/Brave (Chromium-based): same MV3 manifest in principle, `not-verified` on Windows. | `public-doc` / `planned` — Phase 1 Chromium only |
| 3.2 | Automatic capture of all downloads | IDM publicly describes intercepting browser downloads automatically once integrated. | **Not in Phase 1.** Handoff is user-initiated (context menu / popup click, with optional confirmation). Auto-capture of every link is decision D-05, default OFF, requiring separate justification + store-policy review. | `public-doc` / out of scope (Phase 1) — deliberate, stated gap |
| 3.3 | Extension permissions / privacy posture | IDM's browser module is a native component with broad integration by design; its exact permission model is proprietary and was not verified here. | Minimal MV3 permissions (`contextMenus`, `storage`, `activeTab` for popup only). No `<all_urls>`, no `cookies`, no `webRequest` interception, no credential access (`architecture.md` §5.2, §5.4). This is intentionally narrower than a full traffic-intercepting design. | `not-verified` (IDM detail) / `planned` — Phase 1 design choice |
| 3.4 | Clipboard monitoring (auto-add URLs copied to clipboard) | IDM publicly offers clipboard monitoring for URLs in some configurations. | Not in Phase 1. Paste-URL is manual (UI/CLI). Clipboard monitoring is a Phase 2 consideration, not a commitment. | `public-doc` / out of scope (Phase 1) |

## 4. Desktop app / platform

| # | Feature | IDM (public description) | Planned implementation | Basis / planned status |
|---|---|---|---|---|
| 4.1 | Platform: Windows | IDM is a Windows-only product (publicly). | Prior run `39866677122` built, installed and smoke-launched the app. Run `39960878271` passed desktop settings and lifecycle through Cancel; Edge profile cleanup then failed before browser results were confirmed. User-machine compatibility remains unverified. | `public-doc` / `implemented-partial` (runner smoke evidence; browser E2E rerun pending) |
| 4.2 | Platform: macOS / Linux | IDM does not publicly offer macOS or Linux versions. | Linux is the Phase 1 prototype platform. macOS is not planned in Phases 1–3 unless a separate decision adds it (Tauri could make it feasible, but it is not committed). | `public-doc` / `planned` (Linux Phase 1 only) |
| 4.3 | Desktop UI | IDM has a mature native Windows UI with download list, progress, categories, scheduler. | Tauri 2 + React/TypeScript/Tailwind shell starts/resumes CLI jobs; displays progress/speed/ETA; provides a configurable concurrency queue, persisted settings/history and pause/cancel. Linux tests pass. Windows automation has verified settings, queue, pause/restart/resume, completion and cancel. The browser leg still needs its Native Messaging result confirmed. Priority/reordering, scheduler and historical charts remain incomplete. | `public-doc` / `implemented-partial` (Linux verified; Windows browser E2E rerun pending) |
| 4.4 | Installer / auto-update / code signing | IDM ships as a commercial Windows installer with updates. | Phase 3 work: packaging format undecided (D-11: MSI vs MSIX vs portable ZIP), signing undecided, auto-update undecided (D-12). Nothing here is claimed as done. | `public-doc` / `planned` (Phase 3) |
| 4.5 | Multilingual UI | IDM publicly offers multiple UI languages. | Phase 1: English UI strings. Localisation (including Arabic, given this project's user context) is Phase 3 polish, not Phase 1. | `public-doc` / `planned` (Phase 3) |
| 4.6 | System integration: shutdown on completion, prevent sleep | IDM publicly offers shutdown / sleep options on completion. | Linux prototype: `systemd-inhibit` if available (`planned`, `not-verified` on this VM). Windows power APIs: Phase 2, `not-verified`. Never force shutdown without user confirmation. | `public-doc` / `planned` (Phase 2) |

## 5. Scheduler, automation, and advanced features

| # | Feature | IDM (public description) | Planned implementation | Basis / planned status |
|---|---|---|---|---|
| 5.1 | Download scheduler (days/times) | See 1.7. | See 1.7. Weekly windows + one-shot schedules. | `public-doc` / `planned` |
| 5.2 | Site grabber / spider (download a whole site) | IDM publicly offers a site-grabber feature. | **Out of scope.** No crawler/spider in Phases 1–3 as currently scoped. Users download explicit URLs / playlists. | `public-doc` / out of scope |
| 5.3 | Batch download (list of URLs / import file) | IDM publicly supports importing URL lists / batch downloads in some flows; specifics not verified here. | CLI batch: a URL list file is a natural Phase 1 extension of `download.add` (one call per line) — `planned`, not yet specified in detail. UI batch import is Phase 2. | `not-verified` (IDM detail) / `planned` |
| 5.4 | Torrent / P2P support | IDM does not publicly present itself as a torrent client. | Out of scope (all phases as currently scoped). | `public-doc` / out of scope |
| 5.5 | Cloud / sync / account | IDM is a local desktop product; no cloud-sync account is its public model. | Out of scope. No server component, no account, no telemetry (`architecture.md` §1.2). | `public-doc` / out of scope |
| 5.6 | Drag-and-drop URL / browser drag | IDM publicly supports drag-and-drop of links in some flows; not verified here. | Not in Phase 1. Paste + extension handoff are the Phase 1 entry points. Drag-and-drop is Phase 2 UI polish if the Tauri frontend supports it cleanly. | `not-verified` / `planned` (Phase 2, optional) |

## 6. Security and privacy posture (where this project deliberately differs)

| # | Feature | IDM (public description) | Planned implementation | Basis / planned status |
|---|---|---|---|---|
| 6.1 | Handling of browser cookies / login sessions | IDM's browser integration necessarily interacts with the browser session to capture authenticated downloads; its exact handling is proprietary and was not verified here. | **This project does not use browser cookies/sessions at all.** Extension sends URL + user-visible metadata only. No credential storage, no session harvesting (`architecture.md` §5.4, §12). This is a deliberate narrowing: some authenticated downloads that IDM might capture will not work here, and that trade-off is accepted for privacy/security. | `not-verified` (IDM detail) / `planned` — deliberate difference |
| 6.2 | Local API exposure | Not applicable as a public IDM feature description. | Loopback-only API (`127.0.0.1`), bearer token from a `0600` config file, private-host targets blocked by default (`architecture.md` §12.2–12.3). | `planned` |
| 6.3 | Telemetry / analytics | IDM's data practices are governed by its own privacy policy; not assessed here. | None. No telemetry, no analytics, no phone-home. Logs stay local (`architecture.md` §11.4, §15.3). | `not-verified` (IDM) / `planned` |

---

## Summary gap map (Phase 1 honest position)

**What Phase 1 aims to prove (Linux prototype):**

- Correct segmented + resumable HTTP(S) downloading with checkpointing
  (rows 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.12) — the engine core.
- A minimal, honest browser handoff (row 1.8, 3.1-Chromium) that
  does not overreach on permissions.
- A narrow, lawful media path (rows 2.2–2.3) that refuses encrypted
  content instead of pretending otherwise.

**What Phase 1 explicitly does NOT match (gaps, not hidden):**

- Windows CI has previously built, installed and smoke-started the Tauri NSIS application; new Windows GUI and Native Messaging automation is pending, and manual Windows 10/11 compatibility remains unverified (4.1, 4.4).
- Tauri progress/speed/ETA, concurrent queue, settings/history and Pause/Cancel/Resume are implemented and Linux-tested. Windows automation and live browser handoff remain unverified; queue priority/reordering and scheduler remain incomplete (4.3).
- No automatic download capture, no site grabber, no clipboard
  monitoring (3.2, 5.2, 3.4).
- No dynamic segmentation, no fMP4 remux, no live-playlist capture
  (1.2, 2.5, 2.2-live).
- No authenticated/session-based downloads via browser cookies (6.1)
  — deliberate.
- No speed-multiple claim of any kind (1.11) — `not-run`.

**What would be needed to claim closer parity:** a real Windows
machine + Tauri build + Windows browser testing (Phase 2), a
completed UI (Phase 2), signing/packaging (Phase 3), and a
re-measurement of every `planned` row against its Phase 1/2 test
report. Until then, this matrix is a plan and a gap list, not a
parity statement.

---

## Sources and method note

- IDM column: public IDM feature descriptions (tonec.com product /
  features / help pages, as generally and publicly described). No
  IDM binary, installer, or proprietary material was accessed.
- This project's column: `architecture.md` in this same `docs/`
  folder, plus `roadmap.md` for phasing.
- If any IDM row is wrong, the correction path is: check IDM's
  current public docs, fix the row, and keep its label. Do not
  "fix" it by testing a binary that is not authorised/available.
- This matrix was written 2026-10-21 in a Linux-only environment
  (Node 24.20.0, Python 3.12.3, no Rust toolchain, no Windows
  machine). Re-verify IDM public docs before any external
  publication — public feature pages change between versions.
