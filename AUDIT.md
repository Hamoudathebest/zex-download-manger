# Repository audit

**Audited:** 2026-10-22
**Repository:** `Hamoudathebest/zex-download-manger`
**Auditor environment:** Ubuntu 24.04-class x86_64 VPS, Linux kernel 6.8; Git 2.43.0, Rust/Cargo 1.96.1, Node 22.23.1, npm 10.9.8, Python 3.12.3, Google Chrome and FFmpeg available. No Windows host or NSIS compiler was available.

## Repository and access

- Cloned the exact public repository over HTTPS. `origin` points to `https://github.com/Hamoudathebest/zex-download-manger.git`.
- Initial checkout was clean on `main`, tracking `origin/main` at `1e6ddc1` (`Phase 2 batch 1: add extension/firefox/popup.js`). No tags or other remote branches were advertised.
- Anonymous `git ls-remote` succeeded. At initial checkout, `gh auth status` reported no login; the user subsequently configured auth, and the verified current account, permissions, published branch and PR are recorded in `docs/github-access-diagnosis.md`.
- This VPS does not provide independent agent orchestration; engineering responsibilities are handled as a single integrated workstream, not represented as ten independent agents.

## Inventory and implementation state

The checkout contains Rust engine sources/tests, Chromium and Firefox extension sources, media playlist parsing and FFmpeg command construction, a React/TypeScript UI, an NSIS script, benchmark and project documentation. Existing code and history were preserved.

| Component | Observed status |
|---|---|
| Rust engine (`engine/`) | Real CLI implementation: HTTP(S), byte-range probing, parallel segments, no-range fallback, JSON checkpoint/resume, retries, aggregate throttling, SHA-256 and atomic final rename. This is a CLI prototype, not an app service or Tauri backend. SQLite persistence, queue/scheduler, dynamic segment sizing and desktop API are absent. |
| Engine validation | Release-mode build completed without compiler warnings; Rust unit tests 2/2, Native Messaging tests 7/7 and local HTTP integration tests 10/10 pass (see `TEST_REPORT.md`). |
| Browser extension (`extension/`) | Chromium MV3 and Firefox-specific source/manifest exist. The Rust Native Messaging host and Tauri per-user Chromium registration UI are implemented; live browser handshake/download remains unverified, and Firefox packaging/pairing is incomplete. |
| Media (`media/`) | Static HLS/DASH playlist parsing, variant/audio/subtitle metadata, DRM marker refusal and FFmpeg command builder exist. Playlist fetching/segment transfer, end-to-end media jobs, and conversion/merge execution are absent. |
| UI (`ui/`) | React/TypeScript interface with ten navigation views and a Tauri 2 shell. It starts the real CLI, polls actual progress, persists jobs shared with Native Messaging, and registers Chromium host manifests per-user. Linux cargo build/tests pass. Windows app install/start smoke passes on `windows-latest`; pause/cancel, queue/scheduler and service lifecycle remain missing. |
| Installer | Tauri NSIS bundle packages the desktop app and engine resources; Windows CI silently installed it and confirmed the app process stays alive through startup. Legacy `installer/download-manager.nsi` remains a separate CLI-only installer script. No MSI project exists. |
| CI/release | Windows run `39850739198` passed engine tests, Native Messaging tests, Tauri build/NSIS install/start smoke, media tests and extension checks, and uploaded three Windows executables. The tag workflow subsequently published development pre-release `v0.2.0` with checksummed assets. |
| Documentation | README, license, contribution, security, changelog, third-party notices, and lowercase `docs/architecture.md` / `docs/roadmap.md` exist. Root `ARCHITECTURE.md`, `ROADMAP.md`, `AUDIT.md` and `TEST_REPORT.md` were missing before this audit. |

No IDM binary or proprietary IDM source was present or analyzed. No parity, speed superiority, Windows operation, or release readiness is established by this audit.

## Checks run

- `cargo test --locked` in `engine/`: **2 passed**.
- `cargo build --release --locked` in `engine/`: **passed** with no warnings after cleanup.
- `python3 -m unittest -v test_engine` in `engine/tests/`: **10 passed** against the built release binary and loopback-only HTTP fixtures. This includes single and segmented transfer, pause/resume, no-range fallback, redirect, expected-hash rejection, real throttling, changed-size resume rejection, 404 and unknown-length transfer.
- Native Messaging: **5 Rust unit tests + 2 protocol subprocess tests passed**, including shared-state record persistence.
- Tauri backend: **4 Rust tests passed** for shared-state import/merge, completion reconciliation, progress parsing and safe filenames.
- `npm ci && npm run build` in `ui/`: **passed** (TypeScript + Vite production build); npm reported **0 vulnerabilities** across 54 audited packages.
- `python3 tests/run_tests.py` in `media/`: **27 checks passed**.
- Extension JS/JSON validation: **passed** with Node syntax checks and Python JSON parsing for both manifests and the Chromium Native Messaging template.
- `npm run lint` in `ui/`: **passed with no warnings** after removing the unnecessary Fast Refresh export.
- `cargo fmt --check` and Clippy: **pass** for the engine and Tauri backend after fixing existing formatting, unused-code warnings and lint findings.
- The Python engine integration harness failed on its first invocation because it requires `engine/target/release/dm`; after building that binary the full suite passed. This is a test prerequisite, not an implementation failure.
- A test command run from `engine/` instead of `engine/tests/` reported module-not-found; rerun from its documented test directory passed.
- `makensis` is not installed locally. The Tauri NSIS installer was built, silently installed and start-smoke-tested on `windows-latest`. Browser live-tests, interactive Windows 10/11 user-machine tests, GUI-driven download completion, and uninstaller execution have not been performed.

## Priority gaps

1. Keep the passing Windows CI run and artifact hashes recorded; next verify a GUI-driven download and browser handoff on an interactive Windows 10/11 machine.
2. Validate the newly added Native Messaging-to-engine download test on Windows, then run live Chrome/Edge/Brave browser pairing; Firefox packaging remains incomplete.
3. Add pause/cancel controls, SQLite-backed history, queue and scheduler lifecycle.
4. Add end-to-end media transfer around the parser, with explicit user selection and protected-content refusal.
5. Add ETag-change, flaky-server retry and crash-kill recovery regression tests.
6. Validate Windows 10/11 user-machine install, upgrade/uninstall, handoff and recovery; the CI runner does not establish user-machine compatibility.

## GitHub publication status

The VPS is authenticated as `Hamoudathebest`; GitHub API reports repository push/admin permissions. Branch `engineering/audit-windows-ci` and PR #1 target `main`; latest pushed commit is `36cbc6d`. Branch protection is disabled. Development pre-release `v0.2.0` is published; subsequent milestone commits must be pushed to this PR branch and checked in Actions before merge or additional releases.

## Changes made during this audit

Added root-level audit/test reports and navigation entries for the existing architecture and roadmap docs. Added Windows build and tag-triggered pre-release workflows, plus Windows-aware executable naming/Ctrl-Break tests. Added a Rust Native Messaging executable with framing and shared-state tests. Added a Tauri 2 application that starts the real CLI, persists job state, displays observed progress, merges browser-submitted jobs, and registers Chromium Native Messaging from the browser integration screen. Linux Tauri build/tests/Clippy pass, and Windows run `39850739198` built the NSIS installer, installed it and smoke-launched the desktop app. Development pre-release `v0.2.0` is published; live browser handshake, GUI-driven download and interactive Windows 10/11 coverage remain pending.
