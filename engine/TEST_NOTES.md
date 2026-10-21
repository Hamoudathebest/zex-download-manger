# TEST_NOTES — Phase 1 engine, real results

**Date:** 2026-10-21. **Machine:** this Linux VM (Python 3.12, Node 24,
rustc/cargo 1.99.1 installed during this task — see README.md).
**No numbers below are simulated or estimated.** Where a behaviour was
not exercised, it is labelled **not-run**, not passed.

## Fixture (shared by all HTTP tests)

Deterministic 5 MiB file, `random.Random(42)` bytes, generated fresh
per test run (same bytes every run):

- Size: **5,242,880 bytes** (5 MiB)
- SHA-256: **`d3ae61b45776da0f6b6ff7cef1868c8f4922672d323e25c43ff46784048ca3a4`**
- Server: loopback only (`127.0.0.1`, ephemeral port), from the sibling
  harness `tests/test_server.py` (`/file.bin` = Range-capable,
  `/no-range.bin` = deliberately ignores Range) plus two tiny inline
  servers in `tests/test_engine.py` (302 redirect; no-Content-Length).

## Suite 1 — Engine integration (`tests/test_engine.py`, drives the real `dm` binary)

Final run: **10/10 PASS in 12.852 s** (command:
`python3 -m unittest test_engine`, from `engine/tests/`).

| # | Case | Result (final run) |
|---|------|--------------------|
| 01 | Single-connection download (`--connections 1`) | PASS — rc 0, 5,242,880 bytes, SHA-256 matches, wall 0.022 s |
| 02 | Multi-part, 4 connections | PASS — rc 0, 5,242,880 bytes, SHA-256 matches, wall 0.024 s |
| 03 | Pause (SIGINT) + `--resume` | PASS — pause rc **130**; checkpoint showed **1,072,128 / 5,242,880 bytes** over 4 segments; resume rc 0, final SHA-256 matches; `.part` and checkpoint removed after success |
| 04 | No-Range fallback (`--connections 4` on `/no-range.bin`) | PASS — stderr "falling back to 1 connection", rc 0, SHA-256 matches |
| 05 | Redirect (302 → `/file.bin`) | PASS — rc 0, SHA-256 matches |
| 06 | SHA-256 mismatch (`--sha256 000…0`) | PASS — rc 1, destination **not** created, `.part` kept; error reports expected `000…0`, got `d3ae61b4…` |
| 07 | Throttle (`--throttle 1m`, 5 MiB) | PASS — **5.015 s** wall, avg **1.00 MiB/s** (cap is real and aggregate, not per-connection) |
| 08 | Resume validation (checkpoint size tampered +12,345) | PASS — rc 1, "file changed on server: checkpoint size 5255225 != current size 5242880. Refusing to resume…"; `--restart` then succeeds with matching SHA-256 |
| 09 | HTTP 404 | PASS — rc 1, "probe failed: HTTP 404 Not Found", no destination file |
| 10 | Unknown length (no Content-Length, HTTP/1.0 close-delimited) | PASS — rc 0, 5,242,880 bytes, SHA-256 matches |

Notes on the numbers:

- **Loopback speeds are not internet speeds.** Cases 01/02/04/05/10
  finish in ~0.01–0.04 s of download time on loopback. The reported
  "avg KiB/s" figures from the binary (hundreds of thousands of KiB/s)
  are arithmetic on those tiny elapsed times and are **not** meaningful
  performance claims; only the wall times, sizes and hashes above are
  quoted as results.
- **More connections did not help here** (case 01: 0.022 s wall vs
  case 02: 0.024 s wall on loopback). No claim is made that more
  connections = faster; see SPEC.md §3.
- **A real failure was found and fixed during testing.** First run:
  9/10, case 04 failed after 5 retries (backoff 0.5/1/2/4/8 s, visible
  in logs) with "unexpected HTTP 200 OK for Range request". Root cause:
  a full-file segment served as a 200 full body was rejected. Fix: a
  segment that *is* the whole file now accepts a 200 body when nothing
  has been written yet; partial segments still reject 200 (accepting it
  would corrupt the file), and resuming an incomplete download from a
  no-Range server is now refused with a `--restart` message. After the
  fix the suite is 10/10, including a re-run confirming the fix.
- **A measurement artifact was found and fixed.** Initially every
  download reported ~0.50 s elapsed because the main task awaited the
  500 ms progress reporter on shutdown. The reporter is now aborted on
  completion; elapsed times above are post-fix.

## Suite 2 — Rust unit tests (`cargo test --release`)

**2/2 PASS:** `segments_cover_exactly` (segment splits for
(10,4), (100,3), (1,4), (1024,8) cover exactly, contiguously) and
`rate_suffixes` (plain, `k`, `m` parsing; bad suffix rejected).

## Suite 3 — Sibling QA harness (`tests/test_downloads.py`, untouched)

**9/9 PASS in 0.719 s.** This suite tests server behaviour with
urllib/curl clients, not the engine; it was re-run to confirm the
engine work did not disturb it. Its README note "engine-integration
tests are PENDING" is now stale — superseded by Suite 1 above.

## Not-run (implemented, but not live-tested — do not claim as verified)

- **ETag change detection:** code path exists (resume refuses on ETag
  change when both old and new ETags are present), but the local test
  server sends no ETag (`etag=None` in every probe log), so no live
  ETag test was possible in this phase.
- **HTTPS:** implemented via rustls, but all test servers are plain
  HTTP on loopback; no TLS handshake was exercised.
- **Dedicated flaky-server retry test:** the retry loop and its
  0.5/1/2/4/8 s backoff schedule were observed in logs during the
  pre-fix case-04 failure run, but no systematic flaky-server test
  (e.g. a server that drops connections mid-stream) was run.
- **No Windows build, no `.exe`:** Linux VM only; nothing was built
  or tested for Windows.
- **Large-file / disk-full / very-slow-network behaviour:** not
  tested beyond the 5 MiB loopback fixture.
