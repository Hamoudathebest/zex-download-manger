# Changelog

All notable changes to this project are documented here. The format
follows Keep a Changelog, and versioning follows Semantic Versioning
(`vMAJOR.MINOR.PATCH`).

## [Unreleased]

- Added desktop Resume, Pause and Cancel actions backed by checkpoint/control
  files. Linux backend tests pass; this newest GUI control change is awaiting
  its Windows CI run.
- Open-source pack: MIT `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
  `THIRD_PARTY_NOTICES.md`, and this changelog.
- Published audit branch `engineering/audit-windows-ci` and pull
  request #1 to `main`; access and commit publication are verified.
- Windows CI run `39856467213` passed engine/host tests, Tauri build,
  NSIS install/start smoke, media and extension checks, and uploaded the
  CLI, Native Messaging host and installer artifacts.
- Published development pre-release [`v0.2.0`](https://github.com/Hamoudathebest/zex-download-manger/releases/tag/v0.2.0)
  after its tag workflow rebuilt, tested and checksummed the Windows assets.
- Tauri 2 desktop source starts the real Rust CLI, persists local download
  records, displays observed progress, and provides per-user Chromium
  Native Messaging registration. Interactive browser handoff remains unverified.
- Native Messaging host protocol and shared download-state persistence
  are implemented and Linux-tested. Firefox pairing remains incomplete.
- Added a loopback end-to-end Native Messaging test that verifies the host
  starts `dm`, downloads the exact fixture bytes and persists the job record.
  It passes on Linux and Windows CI run `39856467213`.
- Icon generation: `tools/generate-icons.py` (standard library only)
  regenerates the extension PNG icons inside CI, because the
  connector snapshot-push route accepts text files only.
- MSI packaging is not implemented. No Firefox extension
  release package or live browser proof is claimed.

## [0.1.0] — 2026-10-21 (Phase 1 foundation)

Initial public foundation. This is a development foundation, not a
finished product and not a claim of parity with Internet Download
Manager.

### Added

- Rust download engine (`engine/`, binary `dm`): HTTP/HTTPS,
  Range detection, parallel segmented downloads (1–32 connections),
  pause/resume via checkpoint JSON, retry with exponential
  backoff, aggregate bandwidth throttle, atomic `.part` + rename
  completion, SHA-256 verification, redirect handling, and
  single-connection fallback for servers without Range support.
- Browser extension (`extension/`, Manifest V3, Chrome/Edge/Brave):
  popup, content script, context menu, per-site toggle (default
  off), and Native Messaging host template with Windows pairing
  instructions. Least-privilege permissions only; no cookies, no
  credentials, no silent capture.
- Media subsystem (`media/`): HLS (`.m3u8`) and DASH (`.mpd`)
  variant parsing, resolution/audio/subtitle selection, FFmpeg
  merge command builder, playlist notes, and a yt-dlp evaluation
  (evaluation only, not bundled, not for DRM/protected content).
- Desktop UI prototype (`ui/`, React + TypeScript + Tailwind):
  all ten planned pages — Dashboard, Active, Completed, Video,
  Queue, Scheduler, Browser Integration, History, Settings,
  Performance — with metrics in a disconnected/empty state rather
  than simulated values.
- Architecture, feature matrix, roadmap, security design,
  benchmarks, and release documentation under `docs/`.

### Tested (loopback only)

- Engine integration tests: 10/10 pass.
- QA harness: 9/9 pass.
- Media parser tests: 27/27 pass.
- UI build passes; extension JSON validates and JavaScript
  passes `node --check`.

### Honest limits (Phase 1)

- No Windows `.exe` or MSI has been built or run; no Tauri app
  exists yet. The Windows build is a GitHub Actions plan, not a
  delivered artefact.
- No IDM reverse engineering was performed: no authorised IDM
  binary was available, and no proprietary code is included.
- The extension has not been live-tested in a real browser, and
  Native Messaging pairing on Windows has not been verified.
- Builds are unsigned by default until a signing credential is
  supplied through GitHub Secrets.
