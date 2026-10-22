# Test report

**Run date:** 2026-10-22
**Environment:** Linux x86_64, Rust/Cargo 1.96.1, Node 22.23.1, npm 10.9.8, Python 3.12.3. Tests used local fixtures; the HTTP engine suite binds only to loopback.

| Check | Result | Command / details |
|---|---|---|
| Rust unit tests | PASS — 2/2 | `cd engine && cargo test --locked` |
| Release engine build | PASS | `cd engine && cargo build --release --locked`; compiler emitted six warnings (unused mutability/assignments and dead code). |
| Engine integration | PASS — 10/10 | `cd engine/tests && python3 -m unittest -v test_engine`; exercises real `dm` binary and a deterministic 5 MiB fixture. Final SHA-256: `d3ae61b45776da0f6b6ff7cef1868c8f4922672d323e25c43ff46784048ca3a4`. |
| UI production build | PASS | `cd ui && npm ci && npm run build`; TypeScript and Vite build succeeded. npm audit found 0 vulnerabilities. |
| Media parser/builder tests | PASS — 27 checks | `cd media && python3 tests/run_tests.py`; HLS, DASH, DRM marker behavior and FFmpeg command construction. |
| Extension source validation | PASS | Node syntax checks for Chromium/Firefox JS sources; Python JSON parsing for both manifests and Chromium Native Messaging template. This does not establish live browser functionality. |
| UI lint | WARNING | `cd ui && npm run lint`; finished with one `react(only-export-components)` warning at `src/App.tsx:15`. |
| Rust formatting check | FAIL | `cd engine && cargo fmt --all -- --check`; pre-existing formatting differences in `engine/src/main.rs` with installed rustfmt. No formatting changes were applied. |
| Browser extension syntax/live operation | NOT RUN | No live extension + paired Native Messaging host test was performed. |
| Windows x64 application/installer | NOT RUN | Test machine unavailable. No Tauri shell exists. NSIS was unavailable locally. |
| GitHub Actions/release | NOT RUN | Workflow definitions were added after the checkout audit, but no authenticated account is configured and no GitHub runner has validated them. |

Loopback transfer timings are correctness diagnostics only and are not internet throughput benchmarks. The UI build is a frontend build, not a desktop application. No portable Windows executable, installer, MSI, signed artifact, or release has been produced by these checks.
