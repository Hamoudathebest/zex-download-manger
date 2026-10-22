# Changelog

All notable changes to this project are documented here. The format
follows Keep a Changelog, and versioning follows Semantic Versioning
(`vMAJOR.MINOR.PATCH`).

## [Unreleased]

- Open-source pack: MIT `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
  `THIRD_PARTY_NOTICES.md`, and this changelog.
- Published audit branch `engineering/audit-windows-ci` and pull
  request #1 to `main`; access and commit publication are verified.
- Windows CI and development pre-release workflows build the CLI,
  Native Messaging host, Tauri UI/NSIS installer, extension package,
  and checksums. First Windows CI run found the test-08 SIGINT issue;
  the fix and a Tauri startup smoke test are in the pending rerun.
- Tauri 2 desktop source now starts the real Rust CLI, persists local
  download records, displays engine progress, and provides per-user
  Chromium Native Messaging registration. The live Windows workflow,
  installer and browser handshake are not yet verified.
- Native Messaging host protocol and shared download-state persistence
  are implemented and Linux-tested. Firefox pairing remains incomplete.
- Icon generation: `tools/generate-icons.py` (standard library only)
  regenerates the extension PNG icons inside CI, because the
  connector snapshot-push route accepts text files only.
- MSI packaging is not implemented. Windows installer output is pending
  a successful Windows CI build/install/launch run. No Firefox extension
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
