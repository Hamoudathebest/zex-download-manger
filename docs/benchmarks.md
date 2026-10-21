# Phase 1 Benchmarks — Performance & Systems

**Status: honest baseline only. No IDM comparison exists or is claimed.**
IDM is a Windows application and no Windows machine or IDM install is
available on this Linux VM, so no benchmark against IDM was run, and
nothing in this document should be read as one.

**Status: Phase 1 engine comparison = NOT RUN (pending).**
When this work started, `engine/` was completely empty. While the
benchmark script was being written, a parallel agent added
`engine/tests/` — a QA harness (`test_server.py`, `downloader.py`,
`test_downloads.py`, `run_tests.py`, `README.md`). That harness's own
README states, in its scope note, that "the engine prototype does not
exist yet" and that its test client runs against a local server with
urllib/curl. The harness's `downloader.py` is a *test client*, not the
engine, so it was deliberately NOT presented as an engine result.
`bench.py` refuses to guess an engine CLI: without an explicit
`--engine-cmd`, the engine row is reported as NOT RUN. Re-run with
`--engine-cmd` once a real engine CLI lands (see "Re-running" below).

## 1. Methodology

The repeatable script is `benchmarks/bench.py` (stdlib Python only,
plus the system `curl` binary for the baseline). Each run:

1. Generates one deterministic test file: 64 MiB of `random.Random`
   (seed `20261021`) bytes. Seeded PRNG output, not a repeating
   pattern, so nothing can compress or shortcut it. Same seed ⇒ same
   file ⇒ same SHA-256 on every run.
2. Starts a local, Range-aware HTTP server bound to `127.0.0.1` on an
   ephemeral port, serving only that file at `/test.bin`. The server
   counts, server-side, (a) accepted TCP connections and (b) HTTP
   requests handled, and reports the delta per download trial.
3. Downloads the file, 3 trials each, with:
   - **curl, single connection** — the baseline: one `curl` invocation,
     one full GET, no ranges.
   - **segmented reference (stdlib, NOT the engine)** — 8 parallel
     `Range` requests via `urllib`, one TCP connection per segment by
     construction, reassembled in order into a preallocated file.
     This is a benchmark-only reference implementation. It is not the
     Phase 1 engine and must not be cited as engine performance.
   - **Phase 1 engine** — NOT RUN (see status above).
4. For every trial it records wall time (`time.monotonic()` around the
   whole download), bytes received, SHA-256 of the received file,
   throughput in MiB/s, and the server-side connection/request deltas.
   A trial counts as passing only if size AND SHA-256 match the source.
   Downloaded files are deleted after hashing unless `--keep` is given.
5. Writes machine-readable results to
   `benchmarks/.bench-work/results.json`.

Timing includes process spawn (curl) / thread-pool setup (segmented
reference) and full SHA-256 hashing is done *after* the timed section,
so hash time is not in the reported seconds. No network beyond
loopback is touched; nothing is uploaded anywhere.

## 2. Environment (measured, 2026-10-21)

| Item | Value |
|---|---|
| OS / kernel | Linux `7.0.0-39-generic` x86_64 (host `htch-runtime`) |
| CPU | AMD EPYC 9D25 126-Core Processor (model name from `/proc/cpuinfo`); **2 logical CPUs visible to this VM** (`nproc` = 2) |
| RAM | 7,935 MiB total (7.7 GiB); ~1,021 MiB available at run time — the VM was under memory pressure during the runs, which is one more reason to treat absolute times as noisy |
| Python | 3.12.3 |
| Node | v24.20.0 (recorded; not used by the benchmark) |
| curl | 8.5.0 (libcurl/8.5.0, OpenSSL/3.0.13) |
| Server / client | loopback `127.0.0.1` only, ephemeral port, Python `ThreadingHTTPServer` |

Disk: 97 GiB available on the workspace volume; the 64 MiB test file is
negligible. `/tmp` is a 512 MiB tmpfs, so the script deliberately keeps
its work dir under `benchmarks/.bench-work/`, not `/tmp`.

## 3. Real results — verbatim script output

Source file for both runs: **67,108,864 bytes (64 MiB)**,
SHA-256 **`9718e678a863be5140e6a260b5fe811e4f04d3f25bcba954c858806015bd462c`**.
Every trial in both runs matched that hash and size exactly.

### Run 1 (2026-10-21, first execution)

```
[setup] generating deterministic 64 MiB test file ...
[setup] source: 67108864 bytes, sha256=9718e678a863be5140e6a260b5fe811e4f04d3f25bcba954c858806015bd462c
[setup] engine: NOT RUN -- engine/ contains files (tests/README.md, tests/downloader.py, tests/run_tests.py, tests/test_downloads.py, tests/test_server.py, tests/__pycache__/downloader.cpython-312.pyc, tests/__pycache__/test_downloads.cpython-312.pyc, tests/__pycache__/test_server.cpython-312.pyc) but no --engine-cmd was supplied, so no CLI was guessed
[setup] local server: http://127.0.0.1:44835/test.bin (loopback only, Range-aware)

== RESULTS (loopback 127.0.0.1 -- NOT internet speeds) ==
  curl_single trial 1: 0.3841s, 67108864 bytes, 166.61 MiB/s, sha_match=True, server_accepts_delta=1, server_requests_delta=1
  curl_single trial 2: 0.1526s, 67108864 bytes, 419.42 MiB/s, sha_match=True, server_accepts_delta=1, server_requests_delta=1
  curl_single trial 3: 0.1455s, 67108864 bytes, 439.81 MiB/s, sha_match=True, server_accepts_delta=1, server_requests_delta=1
  segmented_reference_NOT_engine trial 1: 0.5569s, 67108864 bytes, 114.92 MiB/s, sha_match=True, server_accepts_delta=8, server_requests_delta=8
  segmented_reference_NOT_engine trial 2: 0.1520s, 67108864 bytes, 421.16 MiB/s, sha_match=True, server_accepts_delta=8, server_requests_delta=8
  segmented_reference_NOT_engine trial 3: 0.1618s, 67108864 bytes, 395.62 MiB/s, sha_match=True, server_accepts_delta=8, server_requests_delta=8
  engine: NOT RUN

[done] full JSON: /home/hatch/workspace/download-manager/benchmarks/.bench-work/results.json
[done] overall byte-identical: True
```

### Run 2 (2026-10-21, repeat, same command)

```
[setup] source: 67108864 bytes, sha256=9718e678a863be5140e6a260b5fe811e4f04d3f25bcba954c858806015bd462c
[setup] engine: NOT RUN -- engine/ contains files (tests/README.md, tests/downloader.py, tests/run_tests.py, tests/test_downloads.py, tests/test_server.py, tests/__pycache__/downloader.cpython-312.pyc, tests/__pycache__/test_downloads.cpython-312.pyc, tests/__pycache__/test_server.cpython-312.pyc) but no --engine-cmd was supplied, so no CLI was guessed
[setup] local server: http://127.0.0.1:38539/test.bin (loopback only, Range-aware)

== RESULTS (loopback 127.0.0.1 -- NOT internet speeds) ==
  curl_single trial 1: 0.1314s, 67108864 bytes, 486.99 MiB/s, sha_match=True, server_accepts_delta=1, server_requests_delta=1
  curl_single trial 2: 0.2684s, 67108864 bytes, 238.45 MiB/s, sha_match=True, server_accepts_delta=1, server_requests_delta=1
  curl_single trial 3: 0.1201s, 67108864 bytes, 532.98 MiB/s, sha_match=True, server_accepts_delta=1, server_requests_delta=1
  segmented_reference_NOT_engine trial 1: 0.3909s, 67108864 bytes, 163.74 MiB/s, sha_match=True, server_accepts_delta=8, server_requests_delta=8
  segmented_reference_NOT_engine trial 2: 0.1597s, 67108864 bytes, 400.78 MiB/s, sha_match=True, server_accepts_delta=8, server_requests_delta=8
  segmented_reference_NOT_engine trial 3: 0.1711s, 67108864 bytes, 374.15 MiB/s, sha_match=True, server_accepts_delta=8, server_requests_delta=8
  engine: NOT RUN

[done] full JSON: /home/hatch/workspace/download-manager/benchmarks/.bench-work/results.json
[done] overall byte-identical: True
```

(Run 2's JSON is preserved at `benchmarks/.bench-work/results-run2.json`;
`results.json` is overwritten on each run by design. Run 1's numbers
above are its verbatim stdout.)

### Medians (derived from the verbatim rows above, not new measurements)

| Method | Run 1 median | Run 2 median |
|---|---|---|
| curl, single connection | 0.1526 s / 419.42 MiB/s | 0.1314 s / 486.99 MiB/s |
| Segmented reference, 8 segments | 0.1618 s / 395.62 MiB/s | 0.1711 s / 374.15 MiB/s |

## 4. Connection-count observations — what was actually measured

Server-side accepted TCP connections and HTTP requests, per trial,
were identical in every trial of both runs:

- **curl single: 1 accepted connection, 1 request** — every trial.
- **Segmented reference (8 segments): 8 accepted connections,
  8 requests** — every trial.

That is a measurement, not an inference: the server counts accepts in
`get_request()` and requests in the handler, and the deltas are printed
per trial. Two caveats on what it does and does not prove:

1. The segmented reference opens one connection per segment *by
   construction* (urllib, no reuse), so "8" partly restates the design;
   the measured part is that the server indeed saw 8 distinct accepts
   and 8 range requests, and that the 8 parts reassembled to a
   byte-identical file (SHA-256 match in all 6 segmented trials).
2. Request count is not a speed claim. **More connections did NOT make
   the download faster here**: medians for 8-way segmented vs single
   curl differ by ~6–30% in either direction across the two runs,
   well inside the run-to-run noise (individual trials ranged
   0.12–0.56 s for the same method and file). On loopback, bandwidth
   is not the bottleneck — per-connection/thread setup and scheduling
   on a 2-vCPU, memory-pressured VM dominate. Nothing here supports
   "more connections = faster" in general, and nothing here refutes
   it for real WAN conditions either, where per-connection throughput
   caps, latency, and loss change the picture completely.

## 5. What the numbers do mean (and what they don't)

**Do mean:**

- The plumbing works end to end: a Range-aware local server, single
  and 8-way segmented downloads, and SHA-256 verification of all 12
  baseline/reference trials across 2 runs, all byte-identical.
- Loopback throughput for a 64 MiB file on this VM is in the
  low-hundreds of MiB/s for both methods — i.e. the local stack, not
  any downloader logic, sets the pace here.
- Trial 1 of each run was the slowest for the segmented reference
  (0.56 s, 0.39 s) and cold in run 1 for curl (0.38 s), consistent with
  page-cache / process warm-up noise. Three trials are enough to see
  the noise; they are not enough to resolve a <30% method difference.

**Do NOT mean:**

- Anything about internet download speed, ISP throttling, CDN
  behaviour, or real-world server behaviour. Loopback has ~zero
  latency, ~zero loss, and no per-connection rate limit — it is the
  least representative network possible, chosen deliberately so the
  benchmark is repeatable offline.
- Anything about IDM, any other download manager, or the Phase 1
  engine — none of those were run.
- That segmented downloading is useless (or useful). Segmenting pays
  when a single connection is capped or lossy, or when resume
  granularity matters — none of which loopback exercises. That
  hypothesis needs a WAN or traffic-shaped test (see §7).

## 6. Re-running

```sh
cd ~/workspace/download-manager
python3 benchmarks/bench.py --size-mib 64 --trials 3 --segments 8
# larger file / different segmentation:
python3 benchmarks/bench.py --size-mib 256 --trials 5 --segments 16
# once a real engine CLI exists (do NOT guess its flags — use its real ones):
python3 benchmarks/bench.py --engine-cmd "python3 engine/<real-cli>.py {url} -o {out}"
```

`--keep` retains the downloaded files in `benchmarks/.bench-work/`
(default: deleted after hashing; the 64 MiB source `test.bin` and
`results.json` are always kept). Exit code is 0 only if every run
method is byte-identical; the engine NOT RUN row is not a failure.

## 7. What was NOT measured (explicit gaps for later phases)

- **Phase 1 engine performance** — pending; no prototype existed at
  run time (see status at top). The script is ready: supply
  `--engine-cmd` and the engine row appears in the same table, on the
  same server and file, with no other changes.
- **Any comparison against IDM** — not available on this Linux VM;
  never run, never claimed.
- **WAN / real-server performance** — no external host was contacted.
  Loopback results must not be quoted as download speeds.
- **Resume after interruption, retry/backoff, throttling, mirrors,
  concurrent multi-file queues, CPU/memory profiling, large files
  (>1 GiB), tiny files (where per-request overhead dominates),
  servers that ignore `Range`, and non-200/206 error paths** — none
  exercised by this script. (Some of these are covered by the
  `engine/tests/` QA harness as correctness cases, not as benchmarks.)
- **Statistical rigour** — 3 trials × 2 runs, one file size, one
  segment count. No confidence intervals are claimed; medians above
  are descriptive only.
- **Browser-extension / native-host path** — out of scope for this
  benchmark; no browser interaction was performed.
