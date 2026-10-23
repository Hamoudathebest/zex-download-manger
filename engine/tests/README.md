# Download-manager QA harness — Phase 1

**Historical scope note (2026-10-21):** this harness was first written
before the Rust engine existed. That older harness remains in
`test_downloads.py`; the actual engine and Native Messaging tests below
now drive the real binaries against loopback fixtures.

## Files

- `test_server.py` — local Range-capable server (`/file.bin` = Range,
  `/no-range.bin` = deliberately ignores Range, everything else 404).
  Binds `127.0.0.1` only, ephemeral port.
- `downloader.py` — minimal test client: single, Range, 4-part parallel,
  resume-with-fallback, SHA-256 verify, JSON checkpoint (harness format v1).
- `test_downloads.py` — the suite (9 tests, see below).
- `run_tests.py` — verbose runner.
- `test_engine.py` — integration tests for the real `dm` CLI.
- `test_native_host.py` — framed protocol tests for the real native host.
- `test_native_host_download.py` — native host to engine loopback download,
  byte hash and shared state persistence test.

## Run

```sh
cd ~/workspace/download-manager/engine/tests
python3 -m unittest -v test_engine
python3 -m unittest -v test_native_host test_native_host_download
# or
python3 run_tests.py
```

Requirements: Python 3.12 (stdlib only) + `curl` for test 09. No external
network, no DRM circumvention. Build `dm` and `dm-native-host` in release
mode before running the engine/host integration suites; Windows CI performs
this build on `windows-latest`.

## Coverage

| # | Test | What it proves |
|---|------|----------------|
| 01 | single file download | full GET, size + SHA-256 match |
| 02 | multi-part (4 parts) | parallel Ranges reassembled in order, SHA-256 match |
| 03 | interrupted/resumed | 1 MiB partial + Range resume to full, SHA-256 match |
| 04 | no-Range fallback | server returns 200 full body on Range request; client restarts full download |
| 05 | invalid URL | malformed → ValueError; refused → URLError; missing path → 404 |
| 06 | integrity mismatch | wrong expected SHA-256 detected (match=False); correct one passes |
| 07 | checkpoint persistence | checkpoint JSON survives a simulated restart; resume completes; **engine queue persistence = NOT-IMPLEMENTED** (no engine queue format exists) |
| 08 | Range headers contract | 206 + Content-Range for valid range; 416 for out-of-range |
| 09 | curl single download | curl client path, size + SHA-256 match |

Fixture: deterministic 5 MiB file, `random.Random(42)` bytes, generated
fresh per run in a temp dir (same bytes every run, so same SHA-256).
