# ZEX Download Manager

An open-source, IDM-inspired download manager for Windows — built
from scratch, in the open, with no proprietary code.

> **Honest status — read this first.** This is a development build,
> not a finished product or a claim of parity with
> Internet Download Manager (IDM). GitHub Actions built the Windows CLI
> and Tauri NSIS installer, installed it, and smoke-launched the app on
> `windows-latest`, including engine lifecycle controls. The current changes
> add Playwright/CDP Windows GUI and browser tests. Run `39934826380` passed
> settings, queueing, Pause, restart/Resume/completion and Cancel. Its browser
> stage ended with a locked Edge profile during cleanup (`EBUSY`), masking the
> Native Messaging assertion result; retryable cleanup is being added. This is not a
> Windows 10/11 user-machine compatibility test. The browser extension
> has not been live-tested, and builds are
> unsigned by default. The repository now contains a Rust download engine,
> Tauri desktop shell, Native Messaging host, Manifest V3 extension, and
> HLS/DASH parser; see
> [AUDIT.md](AUDIT.md), [TEST_REPORT.md](TEST_REPORT.md), and the "Honest limits" section
> below for exactly what is and is not done.

## Current capabilities (development)

- **Segmented downloads** — the Rust engine (`engine/`, binary
  `dm`) detects Range support, splits eligible files across 1–32
  parallel connections, and falls back to a single connection when
  a server does not support ranges. More connections do not always
  mean faster downloads; the engine is benchmarked, not assumed.
- **Pause and resume** — progress is checkpointed to JSON; Ctrl-C in the
  CLI or Pause in the desktop shell saves a checkpoint for `--resume`.
  Resumed downloads refuse a changed file size or ETag instead of
  silently producing a corrupt file.
- **Retry, throttle, verify** — exponential-backoff retries,
  an aggregate bandwidth throttle, atomic `.part` + rename
  completion, and SHA-256 verification before a file is final.
- **Browser extension** — Manifest V3 for Chrome, Edge, and Brave
  (`extension/`): popup, content script, context menu, and a
  per-site toggle that defaults to off. It only forwards a link
  the user explicitly chose, via Native Messaging. It never reads
  cookies, passwords, or session tokens, and it never silently
  captures downloads.
- **Media** — HLS (`.m3u8`) and DASH (`.mpd`) variant parsing with
  resolution, audio-track, and subtitle selection, plus an FFmpeg
  merge command builder (`media/`). DRM-protected content is
  flagged and skipped, never decrypted. yt-dlp is evaluation-only
  and is not bundled.
- **Desktop UI (in progress)** — React + TypeScript + Tailwind in a
  Tauri 2 shell with ten navigation views. It starts/resumes real CLI
  downloads, displays engine progress/speed/ETA, persists settings/history,
  dispatches queued jobs up to configured concurrency, and supports
  Pause/Cancel. Windows end-to-end GUI automation is in progress; scheduler,
  queue priority/reordering and manual Windows verification remain open.
- **Browser companion** — a Rust Native Messaging host validates chosen
  URLs, starts the real engine and writes shared job state. The Tauri
  app can register Chromium extension IDs. Live browser handshake and
  Firefox pairing remain unverified/incomplete.
- **Persistence** — download checkpoints, settings and desktop history use
  JSON files. SQLite migration and scheduler management remain open.

## Repository layout

```
engine/          Rust download engine (dm) + tests
extension/       Manifest V3 extension + Native Messaging host
media/           HLS/DASH parser, FFmpeg builder, fixtures, tests
ui/              React/TypeScript UI + Tauri desktop application source
tools/           generate-icons.py (stdlib-only PNG icon generator)
docs/            architecture, feature matrix, roadmap, security,
                 benchmarks, release plan, GitHub access diagnosis
benchmarks/      repeatable local benchmark script
qa/              QA test results
.github/         Windows build + release workflows
```

## Building

```bash
# Download engine
cd engine
cargo build --release
./target/release/dm <URL> <DEST> --connections 4
./target/release/dm <URL> <DEST> --resume
./target/release/dm <URL> <DEST> --sha256 <HEX>
./target/release/dm <URL> <DEST> --throttle 1m

# Web preview / frontend build
cd ui
npm ci
npm run build

# Tauri development shell; build the Rust engine first
cargo build --release --manifest-path ../engine/Cargo.toml
npm run tauri:dev

# Media parser tests (Python 3.12, standard library only)
cd media
python3 tests/run_tests.py

# Engine integration tests (loopback only, no external network)
cd engine/tests
python3 test_engine.py
```

## Extension install (development)

Load `extension/` unpacked in Chrome, Edge, or Brave. The extension
manifest references `icons/icon*.png`; those PNG files cannot be
carried by the connector snapshot-push route (text files only), so
regenerate them first:

```bash
python3 tools/generate-icons.py --out extension/icons
```

Native Messaging pairing on Windows is documented in
`extension/native-host/PAIRING.md`. It has not yet been verified
on a real Windows machine and browser — that is a Phase 2 test.

## Releases

Windows Actions run `39850739198` passed: Rust and loopback tests,
Native Messaging protocol tests, Tauri build, NSIS install/start smoke,
media tests, extension syntax checks, and artifact upload. The real PE
artifacts and SHA-256 values are recorded in `TEST_REPORT.md`.

- `.github/workflows/windows-build.yml` — pushes to `main`, pull
  requests and manual runs compile/test the Rust engine and Native
  Messaging host, lint/build the UI, package the Tauri NSIS installer,
  run an install/start smoke test, test media parsing, and upload the
  actual Windows executables as a short-lived CI artifact. The passing
  run installed the package and confirmed that the Tauri app remained
  running during its startup smoke test.
- `.github/workflows/release.yml` — tags `v*.*.*` build and test the
  CLI/native-host binaries, Tauri desktop app and NSIS installer, then
  publish a **pre-release** with a CLI ZIP, Chromium extension ZIP,
  installer and SHA-256 checksums. The installer is unsigned and browser
  pairing requires an extension ID entered in the app. This workflow has
  published development pre-release `v0.2.0` after successful build and
  installer/startup checks.

A Firefox extension package and an MSI are **not produced** by the
current release workflow. Firefox-specific source exists but is not
complete. See
`docs/github-access-diagnosis.md` for access history. The configured VPS
account has write access and PR #1 is open against `main`.

## Current limitations

- The Tauri source builds/tests locally, and CI built/installed the NSIS
  package and smoke-launched the app on `windows-latest`. This is not an
  interactive Windows 10/11 user-machine test. Browser handoff also needs
  a live browser/extension verification before it can be claimed.
- No IDM reverse engineering: no authorised IDM binary was
  available, and no proprietary code is included. The feature
  matrix in `docs/feature-matrix.md` labels every row
  public-doc / planned / not-verified.
- Extension not live-tested; Native Messaging pairing unverified.
- Checkpoint formats differ between the engine and the QA
  harness — convergence is a Phase 2 task (see `docs/roadmap.md`).
- Development builds are unsigned. Expect SmartScreen / unknown-publisher
  warnings until a signing credential and signing workflow are added.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, test, and
submit pull requests, and [SECURITY.md](SECURITY.md) for how to
report a vulnerability privately. Third-party licences are listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

MIT — see [LICENSE](LICENSE). This project contains no proprietary
IDM code and no secrets. If you find either, report it privately
per `SECURITY.md`.
