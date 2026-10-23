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
| Rust engine (`engine/`) | Real CLI implementation: HTTP(S), byte-range probing, parallel segments, no-range fallback, JSON checkpoint/resume, retries, aggregate throttling, SHA-256, atomic final rename, and control-file pause/cancel used by Tauri. This is still a CLI prototype, not a full app service. SQLite persistence, priority/reordering and scheduler are absent. |
| Engine validation | Release-mode build completed without compiler warnings; engine Rust tests 2/2, Native Messaging Rust/protocol tests 9/9 and local HTTP integration tests 12/12 pass (see `TEST_REPORT.md`). |
| Browser extension (`extension/`) | Chromium MV3 and Firefox-specific source/manifest exist. The popup supports explicit URL handoff and the Tauri app registers Chromium Native Messaging. Linux protocol/host tests pass; Windows Edge↔host E2E remains pending after the UI test stopped on its queued fixture. Firefox packaging/pairing is incomplete. |
| Media (`media/`) | Static HLS/DASH playlist parsing, variant/audio/subtitle metadata, DRM marker refusal and FFmpeg command builder exist. Playlist fetching/segment transfer, end-to-end media jobs, and conversion/merge execution are absent. |
| UI (`ui/`) | React/TypeScript interface with ten navigation views and a Tauri 2 shell. It starts/resumes CLI jobs, displays engine progress/speed/ETA, runs a configurable concurrency queue, persists history/settings shared with Native Messaging, and supports pause/cancel, clearing finished history and Chromium host registration. Linux checks pass. Windows WebView2 CDP now works in the test-only build; the latest E2E passed settings, queue insertion and Pause, then stopped at a missing `queued.bin` fixture route. Manual Win 10/11 verification remains separate. Scheduler, queue priorities and reordering remain missing. |
| Installer | Tauri NSIS bundle packages the desktop app and engine resources; Windows CI silently installed it and confirmed the app process stays alive through startup. Legacy `installer/download-manager.nsi` remains a separate CLI-only installer script. No MSI project exists. |
| CI/release | Windows run `39933039276`: dependency audit, engine/host tests, Tauri build and installer passed. Test-only WebView2 CDP worked; settings, queue insertion and Pause passed. E2E timed out waiting for queued work because the fixture omitted `queued.bin`; the route is now added. Existing development pre-release `v0.2.0` predates this work. |
| Documentation | README, license, contribution, security, changelog, third-party notices and lowercase architecture/roadmap docs are present; root audit/test reports track evidence and gaps. |

No IDM binary or proprietary IDM source was present or analyzed. No parity, speed superiority, interactive Windows 10/11 compatibility or release readiness is established by this audit.

## Checks run

- `cargo test --locked` in `engine/`: **2 passed**.
- `cargo build --release --locked` in `engine/`: **passed** with no warnings after cleanup.
- `python3 -m unittest -v test_engine` in `engine/tests/`: **12 passed** against the built release binary and loopback-only HTTP fixtures, including control-file pause/resume/cancel.
- Native Messaging: **6 Rust unit tests + 3 protocol/integration tests passed** on Linux, including shared settings and a loopback host-to-engine download. Host integration passed Windows CI run `39856467213`; new browser↔app UI coverage awaits current CI.
- Tauri backend: **8 Rust tests passed** for shared-state import/merge, completion reconciliation, progress/speed/ETA parsing, checkpoint progress, settings validation, resumability and history-clear retention.
- `npm run lint && npm run build` in `ui/`: **passed** (TypeScript + Vite production build); `npm audit --audit-level=high` reported **0 vulnerabilities**.
- `python3 tests/run_tests.py` in `media/`: **27 checks passed**.
- Extension JS/JSON validation: **passed** with Node syntax checks and Python JSON parsing for both manifests and the Chromium Native Messaging template.
- `npm run lint` in `ui/`: **passed with no warnings** after removing the unnecessary Fast Refresh export.
- `cargo fmt --check` and Clippy: **pass** for the engine and Tauri backend with `-D warnings`.
- `cargo audit`: **no vulnerable engine dependencies** after updating Tokio to 1.54.1. Tauri's Linux-only GTK tree reports two existing advisories (`glib` unsound iterator implementation and unmaintained `proc-macro-error`); the current NSIS Windows target does not compile that Linux stack.
- Windows Playwright/CDP end-to-end automation covers settings, progress/speed/ETA, queueing, pause, restart/resume, completion/hash, cancel cleanup, history clearing and live Chromium Native Messaging. Run `39933039276` verified CDP attachment, settings, queue insertion and Pause; the missing fixture endpoint stopped later assertions. The fixture route is corrected; rerun is pending. Production installers are rebuilt without the test-only debug port.
- The Python engine integration harness failed on its first invocation because it requires `engine/target/release/dm`; after building that binary the full suite passed. This is a test prerequisite, not an implementation failure.
- A test command run from `engine/` instead of `engine/tests/` reported module-not-found; rerun from its documented test directory passed.
- `makensis` is not installed locally. Earlier Windows CI built, installed and start-smoke-tested the NSIS app. Run `39933039276` exercised the UI and passed settings, queue insertion and Pause before a test fixture route failed; no manual Windows 10/11 or uninstaller run has been performed.

## Priority gaps

1. Run the new Windows desktop/Chromium end-to-end automation and fix any Windows-only failures.
2. Verify GUI actions and browser handoff manually on an interactive Windows 10/11 machine; CI automation is not manual user-machine verification.
3. Add queue priority/reordering and a real scheduler; migrate JSON history to SQLite.
4. Add ETag-change, flaky-server retry and crash-kill recovery regression tests, and complete end-to-end media transfer.
5. Validate Windows 10/11 install, upgrade/uninstall and recovery; CI does not establish user-machine compatibility.

## GitHub publication status

The VPS is authenticated as `Hamoudathebest`; GitHub API reports repository push/admin permissions. Branch `engineering/audit-windows-ci` and PR #1 target `main`; latest pushed commit is `678ef3d`. Branch protection is disabled. Development pre-release `v0.2.0` is published; the current desktop expansion is still local and must pass Windows Actions before release packaging.

## Changes made during this audit

Recent unpushed work adds Tauri speed/ETA reporting, persisted engine settings, configurable concurrent queueing, history clearing and close/restart checkpoint handling. It adds explicit URL entry to the Chromium popup and Playwright/CDP Windows end-to-end tests for the download lifecycle and real Edge Native Messaging. Local Rust, Python, UI lint/build and npm audit checks pass. Tokio was updated for a RustSec vulnerability; Tauri's Linux GTK advisory warnings remain. Windows automation is pending the next CI run.
