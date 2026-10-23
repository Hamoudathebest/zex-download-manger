# Test report

**Run date:** 2026-10-23
**Environment:** Linux x86_64, Rust/Cargo 1.96.1, Node 22.23.1, npm 10.9.8, Python 3.12.3. Tests used local fixtures; the HTTP engine suite binds only to loopback.

| Check | Result | Command / details |
|---|---|---|
| Rust unit tests | PASS — 2/2 | `cd engine && cargo test --locked` |
| Release engine build | PASS | `cd engine && cargo build --release --locked`; build completed without warnings. |
| Engine integration | PASS — 12/12 on Linux | `cd engine/tests && python3 -m unittest -v test_engine`; exercises real `dm` against loopback, including pause/resume and cancel through the desktop control file. Fixture SHA-256: `d3ae61b45776da0f6b6ff7cef1868c8f4922672d323e25c43ff46784048ca3a4`. |
| Native Messaging host | PASS — 6 Rust unit + 3 protocol/integration tests on Linux; Windows host E2E pass | Host framing, persisted shared settings and a real loopback transfer through the host into `dm` passed; the fixture hash and shared job record matched. Host integration passed Windows run `39856467213`; new browser↔app UI coverage awaits current CI. |
| UI production build | PASS | `cd ui && npm run build`; TypeScript and Vite build succeeded. `npm audit --audit-level=high` found 0 vulnerabilities. |
| Tauri desktop backend | PASS — 8 tests | `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked` and `cargo check --locked` under `ui/src-tauri/`. Includes checkpoint progress, settings validation, progress/speed/ETA parsing, restart checkpoint eligibility and history clearing that preserves resumable jobs. |
| Media parser/builder tests | PASS — 27 checks | `cd media && python3 tests/run_tests.py`; HLS, DASH, DRM marker behavior and FFmpeg command construction. |
| Extension source validation | PASS | Node syntax checks for Chromium/Firefox JS sources; Python JSON parsing for both manifests and Chromium Native Messaging template. This does not establish live browser functionality. |
| UI lint | PASS | `cd ui && npm run lint`; no warnings. |
| Rust formatting and Clippy | PASS | Both `engine/` and `ui/src-tauri/` pass `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings`. |
| RustSec dependency audit | PASS with advisories noted | Engine lock has no vulnerable dependencies after Tokio 1.54.1. Tauri lock has no vulnerabilities; audit notes existing `glib` unsoundness and unmaintained `proc-macro-error` warnings in the Linux GTK tree. |
| Windows desktop + Chromium E2E | PENDING — added to CI | Playwright/CDP automation covers settings persistence, throttled progress/speed/ETA, one-slot queueing, pause, app restart/resume, completion/hash, cancellation cleanup, history clearing, live Native Messaging ping and extension-triggered download hash. First Windows run is pending. |
| Browser extension syntax/live operation | Syntax PASS; live test pending | Chromium and Firefox JS/manifests validate. Actual Edge ↔ Native Messaging host interaction is included in the pending Windows E2E test; no manual browser run has been done. |
| Windows x64 application/installer | Prior revision PASS — run `39866677122` | Earlier Windows Actions built, installed and smoke-launched the app. This does not establish current-revision E2E results or manual Windows 10/11 compatibility. |
| GitHub Actions Windows CI | PENDING for current changes | Prior run `39866677122` passed. New desktop UI/browser E2E and RustSec audit jobs have been added and await the next push/run. |
| Development pre-release | PASS — [`v0.2.0`](https://github.com/Hamoudathebest/zex-download-manger/releases/tag/v0.2.0) | Tag workflow `39852976111` rebuilt/tested the Windows outputs, ran install/start smoke, packaged the CLI/host and Chromium extension, and published the NSIS installer plus SHA-256 checksums. Downloaded assets passed `sha256sum -c SHA256SUMS.txt`. |

Loopback transfer timings are correctness diagnostics only and are not internet throughput benchmarks. Windows workflow artifact `dm-windows-x64-c518a8e5b95f79da0b491d22d1b6ee77761e14f3` (run `39850739198`) was downloaded and its three PE files identified:

| Artifact | Format | SHA-256 |
|---|---|---|
| `dm-windows-x64.exe` | PE32+ x86-64 console executable | `2c5c9232ce9691daaa3b10879e61f98b0453edd2826c4eb9d4168ba5ff024627` |
| `dm-native-host-windows-x64.exe` | PE32+ x86-64 console executable | `47eb045e045462dfe30cb7d1fcbca87dad941619f2f4f4ed38d2ab39b192a512` |
| `zex-download-manager-setup-windows-x64.exe` | NSIS GUI installer | `18fa86fb18b88defcecc2efe17c468297051dfdf53f642483a85e3906817f6f4` |

These checks establish a successful `windows-latest` build and install/start smoke only. `v0.2.0` is a development pre-release, not a stable release. No MSI, signed binary, Windows 10/11 interactive test, or live browser handshake exists yet.
