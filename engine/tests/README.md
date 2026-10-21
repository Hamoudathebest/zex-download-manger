# Download-manager QA harness — Phase 1

**Scope note (2026-10-21):** the engine prototype does not exist yet
(`engine/` was empty when this harness was written). These tests therefore
run against a **local** Range-capable HTTP server with urllib/curl as the
client. They prove transfer mechanics and server behaviour with real
bytes and real SHA-256 checks. **Engine-integration tests are PENDING**
until the engine lands — re-point the same cases at the engine then.

## Files

- `test_server.py` — local Range-capable server (`/file.bin` = Range,
  `/no-range.bin` = deliberately ignores Range, everything else 404).
  Binds `127.0.0.1` only, ephemeral port.
- `downloader.py` — minimal test client: single, Range, 4-part parallel,
  resume-with-fallback, SHA-256 verify, JSON checkpoint (harness format v1).
- `test_downloads.py` — the suite (9 tests, see below).
- `run_tests.py` — verbose runner.

## Run

```sh
cd ~/workspace/download-manager/engine/tests
python3 -m unittest -v test_downloads
# or
python3 run_tests.py
```

Requirements: Python 3.12 (stdlib only) + `curl` for test 09. No external
network, no Windows machine, no DRM circumvention.

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
