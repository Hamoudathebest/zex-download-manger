# Changelog

All notable changes to this project are documented here. The format
follows Keep a Changelog, and versioning follows Semantic Versioning
(`vMAJOR.MINOR.PATCH`).

## [Unreleased]

- Open-source pack: MIT `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`,
  `THIRD_PARTY_NOTICES.md`, and this changelog.
- GitHub access diagnosis (`docs/github-access-diagnosis.md`):
  the push to `Hamoudathebest/zex-download-manger` is blocked by a
  missing GitHub App installation on the repository owner's account
  (see that document for the exact fix). No code was pushed yet.
- Real CI/CD: `.github/workflows/windows-build.yml` rewritten to
  actually build and test the Rust engine, the UI, and the media
  parser on `windows-latest`; new `.github/workflows/release.yml`
  for tag-triggered releases with portable and extension artefacts
  and SHA-256 checksums.
- Icon generation: `tools/generate-icons.py` (standard library only)
  regenerates the extension PNG icons inside CI, because the
  connector snapshot-push route accepts text files only.
- Not yet shipped: a Windows installer (.exe via NSIS) and an MSI
  (via WiX) are documented as planned, not built, because no
  installer project exists yet. A Firefox extension package is
  likewise planned, not shipped, because no Firefox-compatible
  manifest variant exists yet. These are not claimed in any release
  until they actually build.

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
