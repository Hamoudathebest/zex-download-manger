# Download Manager

An open-source, IDM-inspired download manager for Windows — built
from scratch, in the open, with no proprietary code.

> **Honest status — read this first.** This is Phase 1, a working
> foundation, not a finished product and not a claim of parity with
> Internet Download Manager (IDM). No Windows `.exe` or MSI has been
> built or run yet, there is no Tauri desktop app yet, the browser
> extension has not been live-tested, and builds are unsigned by
> default. What does exist is real and tested on loopback: a Rust
> download engine, a Manifest V3 extension, an HLS/DASH media
> parser, and a React UI prototype. See
> [CHANGELOG.md](CHANGELOG.md) and the "Honest limits" section
> below for exactly what is and is not done.

## Features (Phase 1)

- **Segmented downloads** — the Rust engine (`engine/`, binary
  `dm`) detects Range support, splits eligible files across 1–32
  parallel connections, and falls back to a single connection when
  a server does not support ranges. More connections do not always
  mean faster downloads; the engine is benchmarked, not assumed.
- **Pause and resume** — progress is checkpointed to JSON, so a
  download interrupted with Ctrl-C can be resumed with `--resume`.
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
- **UI prototype** — React + TypeScript + Tailwind (`ui/`) with
  all ten planned pages: Dashboard, Active, Completed, Video,
  Queue, Scheduler, Browser Integration, History, Settings, and
  Performance. Metrics are shown disconnected/empty until the
  engine publishes real state — no simulated speeds.
- **Scheduler, queue, and history** — designed in
  `docs/architecture.md` and `docs/roadmap.md`; per-download
  checkpointing exists in Phase 1, and multi-item queue
  persistence is a Phase 2 task.

## Repository layout

```
engine/          Rust download engine (dm) + tests
extension/       Manifest V3 extension + Native Messaging host
media/           HLS/DASH parser, FFmpeg builder, fixtures, tests
ui/              React/TypeScript/Tailwind UI prototype
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

# UI prototype (Node 20)
cd ui
npm ci
npm run build

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

Releases are built by GitHub Actions on `windows-latest`, never on
a developer's personal machine:

- `.github/workflows/windows-build.yml` — every push/PR to `main`
  builds and tests the engine, UI, and media parser, and uploads
  an unsigned artefact (30-day retention).
- `.github/workflows/release.yml` — version tags `v*.*.*` create a
  GitHub Release with a portable Windows zip, a Chrome/Edge
  extension zip, and `SHA256SUMS.txt`, plus release notes from
  `CHANGELOG.md`.

A Firefox extension package, an NSIS installer, and an MSI are
**planned, not shipped**: they appear in a release only when the
corresponding manifest or installer project actually exists. Until
then the release notes say so plainly. See
`docs/github-access-diagnosis.md` for the current push blocker:
the GitHub App must be installed on the repository owner's account
with this repository selected before the first push can land.

## Honest limits (Phase 1)

- No Windows `.exe` or MSI built or run; no Tauri app; the
  workflows have never run on a Windows runner.
- No IDM reverse engineering: no authorised IDM binary was
  available, and no proprietary code is included. The feature
  matrix in `docs/feature-matrix.md` labels every row
  public-doc / planned / not-verified.
- Extension not live-tested; Native Messaging pairing unverified.
- Checkpoint formats differ between the engine and the QA
  harness — convergence is a Phase 2 task (see `docs/roadmap.md`).
- Builds are unsigned until a signing credential is supplied
  through GitHub Secrets. Expect SmartScreen / unknown-publisher
  warnings on unsigned builds.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, test, and
submit pull requests, and [SECURITY.md](SECURITY.md) for how to
report a vulnerability privately. Third-party licences are listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

MIT — see [LICENSE](LICENSE). This project contains no proprietary
IDM code and no secrets. If you find either, report it privately
per `SECURITY.md`.
