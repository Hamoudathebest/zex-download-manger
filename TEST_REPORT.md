# Test report

**Run date:** 2026-10-22
**Environment:** Linux x86_64, Rust/Cargo 1.96.1, Node 22.23.1, npm 10.9.8, Python 3.12.3. Tests used local fixtures; the HTTP engine suite binds only to loopback.

| Check | Result | Command / details |
|---|---|---|
| Rust unit tests | PASS — 2/2 | `cd engine && cargo test --locked` |
| Release engine build | PASS | `cd engine && cargo build --release --locked`; build completed without warnings. |
| Engine integration | PASS — 10/10 | `cd engine/tests && python3 -m unittest -v test_engine`; exercises real `dm` binary and a deterministic 5 MiB fixture. Final SHA-256: `d3ae61b45776da0f6b6ff7cef1868c8f4922672d323e25c43ff46784048ca3a4`. |
| Native Messaging host | PASS — 5 Rust unit + 2 protocol tests | `cargo test --locked` and `cd engine/tests && python3 -m unittest -v test_native_host`; framing, ping, malformed JSON, URL rejection, filename sanitization and shared-state record persistence tested on Linux. |
| UI production build | PASS | `cd ui && npm ci && npm run build`; TypeScript and Vite build succeeded. npm audit found 0 vulnerabilities across 54 packages. |
| Tauri desktop backend | PASS — 4 tests | `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, `cargo check` and `cargo build` under `ui/src-tauri/`; Linux desktop binary compiled. No desktop window was launched on this headless host. |
| Media parser/builder tests | PASS — 27 checks | `cd media && python3 tests/run_tests.py`; HLS, DASH, DRM marker behavior and FFmpeg command construction. |
| Extension source validation | PASS | Node syntax checks for Chromium/Firefox JS sources; Python JSON parsing for both manifests and Chromium Native Messaging template. This does not establish live browser functionality. |
| UI lint | PASS | `cd ui && npm run lint`; the existing Fast Refresh warning was fixed. |
| Rust formatting and Clippy | PASS | Both `engine/` and `ui/src-tauri/` pass `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings`; unused warnings and two Clippy findings were corrected. |
| Browser extension syntax/live operation | NOT RUN | No live extension + paired Native Messaging host test was performed. |
| Windows x64 application/installer | PASS — `windows-latest` smoke test | The Tauri NSIS installer built, silently installed, and the installed `zex-download-manager.exe` remained running through the 8-second startup check. This does not establish interactive Windows 10/11 user-machine compatibility. |
| GitHub Actions Windows CI | PASS — run `39848492844` | Rust unit tests, 10 engine integration tests, 2 Native Messaging protocol tests, Tauri formatting/Clippy/tests/build, NSIS install/start smoke, media 27/27 and extension syntax all passed. Uploaded three Windows x64 executables. Earlier failed runs exposed test signal and smoke path/selector issues, fixed in this run. |
| GitHub Release | NOT RUN | No release tag or verified release artifact has been produced. |

Loopback transfer timings are correctness diagnostics only and are not internet throughput benchmarks. Windows workflow artifact `dm-windows-x64-ea44a69e4de57a06338111e40508ddbcd26d1aa0` (run `39848492844`) was downloaded and its three PE files identified:

| Artifact | Format | SHA-256 |
|---|---|---|
| `dm-windows-x64.exe` | PE32+ x86-64 console executable | `fbd89bea7f23e0e485c1d6d5ed6476bb1d90fc70b62a07802b2e601e4923465b` |
| `dm-native-host-windows-x64.exe` | PE32+ x86-64 console executable | `3f65f51b67a167258ccf35e94520257f5cd11b20447c192fe6c6ed1408fec0c8` |
| `zex-download-manager-setup-windows-x64.exe` | NSIS GUI installer | `c2a37352bf677422e9f289bb2d7a2203c6e00f9fd7c05540296c3e66d8ed4658` |

These checks establish a successful `windows-latest` build and install/start smoke only. No stable release, MSI, signed binary, Windows 10/11 interactive test, or live browser handshake exists yet.
