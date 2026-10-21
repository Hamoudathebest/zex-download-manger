# QA Test Results — Download Manager, Phase 1

**Agent:** Agent 9 — QA & Automation Engineer
**Date of run:** 2026-10-21 (evening, CET)
**Status: 9 / 9 PASS** (two consecutive full runs green; one earlier run
had 8/9 with a single test-expectation bug, fixed and re-verified — see
"Run history" below). **No results are simulated:** every number below
comes from real HTTP transfers against the local test server.

## 0. Scope finding — read this first

When this work started, `~/workspace/download-manager/engine/` was
**empty** (no prototype, no queue file format, no other tests to
coordinate with — nothing was overwritten). Per the task brief, a
minimal test harness was therefore built instead of engine-integration
tests:

- The "engine under test" here is a **test client** (`urllib`, plus
  `curl` in test 09) talking to a **local Range-capable server**.
- What this suite proves: transfer mechanics and server behaviour
  (single / multi-part / resume / no-Range fallback / error handling /
  SHA-256 verification / checkpoint persistence), with real bytes.
- What it does **not** prove: that the future real engine behaves this
  way. **Engine-integration tests are PENDING** until the engine lands;
  the same cases should then be re-pointed at the engine. This is a
  harness, not an engine pass/fail verdict.

## 1. Environment

| Item | Value |
|---|---|
| OS / kernel | Linux htch-runtime 7.0.0-39-generic x86_64 (Ubuntu-based VM) |
| Python | 3.12.3 (stdlib only — no third-party test deps) |
| Node | v24.20.0 (not used by this suite; recorded for completeness) |
| curl | 8.5.0 (libcurl/8.5.0, OpenSSL/3.0.13) — used only in test 09 |
| Network | Loopback only (`127.0.0.1`, ephemeral port). No external network used, no production system touched |
| Windows machine | None available — Windows tests are NOT RUN (see §5) |

## 2. Fixture (deterministic, regenerated every run)

- Size: **5,242,880 bytes (5 MiB exactly)**
- Bytes: `random.Random(42).randbytes(...)` in 64 KiB chunks, written
  to a temp dir, served from disk by the local server
- SHA-256 (identical on every run, verified across 3 runs):
  **`d3ae61b45776da0f6b6ff7cef1868c8f4922672d323e25c43ff46784048ca3a4`**
- Because the server is on loopback, timings below are loopback
  timings, **not** internet download speeds — they prove completion
  and correctness, not throughput.

## 3. How to re-run

```sh
cd ~/workspace/download-manager/engine/tests
python3 -m unittest -v test_downloads
# equivalent verbose runner:
python3 run_tests.py
```

Exit code 0 = all pass. No setup beyond Python 3.12 (+ curl for test 09).
The server binds an ephemeral `127.0.0.1` port per run and shuts down
in `tearDownClass`; fixture files live in a temp dir that is deleted
after the run.

## 4. Results — full pass/fail list

Final run (2026-10-21, `python3 -m unittest -v test_downloads`):

```
test_01_single_file_download ............ ok
test_02_multipart_download_4_parts ...... ok
test_03_interrupted_resumed_transfer .... ok
test_04_no_range_fallback ............... ok
test_05_invalid_url ..................... ok
test_06_integrity_mismatch_detected ..... ok
test_07_checkpoint_persistence .......... ok
test_08_range_headers_contract .......... ok
test_09_curl_single_download ............ ok
----------------------------------------------------------------------
Ran 9 tests in 0.818s — OK
```

Stability re-run (`python3 run_tests.py`, immediately after):

```
Ran 9 tests in 0.680s — OK   (same fixture SHA-256, same sizes)
```

### Per-test detail (final run — real output)

| # | Test (task requirement) | Result | Real numbers |
|---|---|---|---|
| 01 | Single file download | **PASS** | size=5,242,880; sha256=`d3ae61b4…48ca3a4` (full value §2); time=0.047 s |
| 02 | Multi-part download (4 parallel Ranges) | **PASS** | parts=4; size=5,242,880; sha256=`d3ae61b4…48ca3a4`; time=0.047 s |
| 03 | Interrupted / resumed transfer | **PASS** | interrupted at partial_size=1,048,576 (HTTP 206 for `bytes=0-1048575`); resumed=True; final_size=5,242,880; sha256=`d3ae61b4…48ca3a4`; resume time=0.019 s |
| 04 | No-Range fallback | **PASS** | server proof: `Range: bytes=0-99` → **200 + full body** (len=5,242,880, no `Accept-Ranges`); client fallback: resumed_flag=False (correctly did NOT claim a 206 resume); final_size=5,242,880; sha256=`d3ae61b4…48ca3a4` |
| 05 | Invalid URL | **PASS** | 05a malformed `ht!tp://::bad` → `URLError` (unknown url type); 05b connection refused `127.0.0.1:1` → `URLError`; 05c missing path → `HTTPError 404` |
| 06 | Integrity mismatch (wrong SHA-256 detected) | **PASS** | file downloaded intact (5,242,880 bytes); expected(wrong)=`0000…0000` (64 zeros); actual=`d3ae61b4…48ca3a4`; match=**False** (mismatch detected); control check with the correct digest → match=True |
| 07 | Queue / checkpoint persistence | **PARTIAL — see note** | checkpoint JSON written at downloaded=1,048,576 / 5,242,880; reloaded from disk after simulated restart (downloaded, total_size, expected_sha256 all intact); resumed=True; final_size=5,242,880; sha256=`d3ae61b4…48ca3a4` |
| 08 | Range headers contract (extra) | **PASS** | `bytes=10-19` → **206**, `Content-Range: bytes 10-19/5242880`, body len=10; out-of-range `bytes=5242880-` → **416** |
| 09 | curl single download (extra) | **PASS** | curl rc=0; size=5,242,880; sha256=`d3ae61b4…48ca3a4`; time=0.045 s |

**Test 07 note — queue persistence is PARTIAL / NOT-IMPLEMENTED.**
No engine queue file format exists (engine was empty), so there is no
engine queue to persist or reload. What test 07 actually proves is
**checkpoint persistence in the harness-defined JSON format v1**
(`version`, `url`, `dest`, `total_size`, `downloaded`, `parts[]`,
`expected_sha256`) plus resume-from-checkpoint. A true engine queue
persistence test (multi-item queue surviving an engine restart, in the
engine's own format) is **pending the engine** and must not be claimed
as done.

**SHA-256 values in full:** fixture / every correctly completed
download = `d3ae61b45776da0f6b6ff7cef1868c8f4922672d323e25c43ff46784048ca3a4`;
deliberately wrong expected value in test 06 =
`0000000000000000000000000000000000000000000000000000000000000000`.

### Run history (honesty note)

- Run 1: **8/9**. `test_05` failed — the test asserted `ValueError`
  for a malformed URL, but Python 3.12's urllib actually raises
  `URLError: unknown url type: ht!tp` for that input. The test
  expectation was wrong, not the download behaviour; the test was
  corrected to assert the real exception, and the server's body-writer
  was hardened to swallow `BrokenPipeError`/`ConnectionResetError`
  (client disconnecting mid-body) so server-thread tracebacks do not
  pollute output. No fixture, server, or downloader behaviour was
  changed to force a pass.
- Runs 2 and 3 (after the fix): **9/9, twice**, same sizes and SHA-256.

## 5. What was NOT tested here (and why)

| Not tested | Why |
|---|---|
| **Browser integration live test** | Requires a live browser + extension native-host wiring; this subagent has no live-browser capability, and no extension host exists yet in the repo. Needs a parent/root-delegated browser task once the extension exists. |
| **HLS / DASH end-to-end download** | No HLS/DASH playlist/segment fixtures or engine segment downloader exist yet; out of scope for a Phase 1 HTTP Range harness. Needs segment fixtures + a real engine implementation. |
| **Windows install / uninstall** | **NOT RUN — Phase 2.** No Windows machine on this Linux VM. Must be run on Windows and labelled as such; nothing here substitutes for it. |
| **IDM comparison** | No IDM binary, no Windows environment, and no agreed comparison methodology/benchmark corpus in Phase 1. Cannot be done honestly from this VM. |
| **Engine-integration tests** | Engine prototype does not exist yet (see §0). Pending re-pointing this suite at the real engine. |
| **Engine queue persistence** | No engine queue format exists (see test 07 note). Pending the engine. |
| **DRM-protected content** | Out of scope by constraint; no DRM circumvention was attempted or tested. All fixtures are locally generated test bytes. |
| **Real-internet throughput / large files / flaky networks** | Loopback-only by design (deterministic, no external dependency). Real-world speeds, >5 MiB files, packet loss, and proxy behaviour need separate benchmarking, not claimed from loopback timings. |

## 6. Files created (this agent only)

All under `~/workspace/download-manager/` — no other workspace or
production system was touched:

- `engine/tests/test_server.py` — local Range-capable test server
  (`/file.bin` Range, `/no-range.bin` ignores Range, 404 otherwise)
- `engine/tests/downloader.py` — minimal harness client (single /
  Range / 4-part parallel / resume-with-fallback / SHA-256 verify /
  JSON checkpoint v1)
- `engine/tests/test_downloads.py` — the 9-test unittest suite
- `engine/tests/run_tests.py` — verbose runner (exit 0 iff all pass)
- `engine/tests/README.md` — harness docs + re-run instructions
- `qa/TEST_RESULTS.md` — this file

## 7. Recommended next steps for the parent

1. When the engine prototype lands, re-point `test_downloads.py` at
   the engine client (same URLs, same fixture, same SHA-256) and add a
   true multi-item queue-persistence test in the engine's own format.
2. Schedule Windows install/uninstall as an explicit Phase 2 task on a
   Windows machine — do not mark it done from Linux results.
3. Add HLS/DASH fixtures + a browser-integration task (parent/root
   browser delegation) as separate follow-ups.
