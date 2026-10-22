# Test report

**Run date:** 2026-10-22
**Environment:** Linux x86_64, Rust/Cargo 1.96.1, Node 22.23.1, npm 10.9.8, Python 3.12.3. Tests used local fixtures; the HTTP engine suite binds only to loopback.

| Check | Result | Command / details |
|---|---|---|
| Rust unit tests | PASS — 2/2 | `cd engine && cargo test --locked` |
| Release engine build | PASS | `cd engine && cargo build --release --locked`; compiler emitted six warnings (unused mutability/assignments and dead code). |
| Engine integration | PASS — 10/10 | `cd engine/tests && python3 -m unittest -v test_engine`; exercises real `dm` binary and a deterministic 5 MiB fixture. Final SHA-256: `d3ae61b45776da0f6b6ff7cef1868c8f4922672d323e25c43ff46784048ca3a4`. |
| Native Messaging host | PASS — 5 Rust unit + 2 protocol tests | `cargo test --locked` and `cd engine/tests && python3 -m unittest -v test_native_host`; framing, ping, malformed JSON, URL rejection, filename sanitization and shared-state record persistence tested on Linux. |
| UI production build | PASS | `cd ui && npm ci && npm run build`; TypeScript and Vite build succeeded. npm audit found 0 vulnerabilities. |
| Tauri desktop backend | PASS — 4 tests | `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo check` and `cargo build` under `ui/src-tauri/`; Linux desktop binary compiled. No desktop window was launched on this headless host. |
| Media parser/builder tests | PASS — 27 checks | `cd media && python3 tests/run_tests.py`; HLS, DASH, DRM marker behavior and FFmpeg command construction. |
| Extension source validation | PASS | Node syntax checks for Chromium/Firefox JS sources; Python JSON parsing for both manifests and Chromium Native Messaging template. This does not establish live browser functionality. |
| UI lint | PASS | `cd ui && npm run lint`; the existing Fast Refresh warning was fixed. |
| Rust formatting and Clippy | PASS | Both `engine/` and `ui/src-tauri/` pass `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings`; unused warnings and two Clippy findings were corrected. |
| Browser extension syntax/live operation | NOT RUN | No live extension + paired Native Messaging host test was performed. |
| Windows x64 application/installer | PARTIAL | Tauri/NSIS installer built on Windows; app install/start smoke failed because the custom install path was not created. The no-space `/D` path fix awaits rerun. No local Windows host is available here. |
| GitHub Actions Windows CI | PARTIAL/FAIL — smoke-test path fix pending | Run `39795062256` exposed and prompted a fix for test 08's unsupported Windows SIGINT. Run `39841646646` passed engine integration and Native Messaging tests and built the Tauri/NSIS installer, then failed because the smoke test couldn't find its custom install directory. The test now uses a no-space install path; third run pending. |
| GitHub Release | NOT RUN | No release tag or verified release artifact has been produced. |

Loopback transfer timings are correctness diagnostics only and are not internet throughput benchmarks. Windows CI built a CLI executable and the Tauri NSIS installer, but failed before artifact upload at the install smoke test. No successful Windows artifact upload, MSI, signed binary, or release exists yet.
