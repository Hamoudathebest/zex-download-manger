# Download Engine — Phase 1 Specification

**Implementation:** full Rust (`dm` binary, see README.md). This spec is
the contract the Rust code implements. The sibling QA harness in
`tests/` (`downloader.py` / `test_downloads.py`) predates the engine and
uses its own, different checkpoint format — see "Checkpoint format"
below for the deliberate difference.

## 1. Goals and non-goals

Goals: correct, resumable, parallel HTTP/HTTPS downloads with bounded
memory, verifiable integrity, and honest failure modes.

Non-goals (Phase 1): no download queue UI, no scheduler, no browser
integration, no DRM circumvention, no credential handling, no Windows
build (this VM is Linux-only; no `.exe` was produced or is claimed).

## 2. Probe: how the engine learns about a URL

Before any byte is written, the engine issues:

1. `HEAD` — reads `Content-Length`, `Accept-Ranges`, `ETag`,
   `Last-Modified`. A rejected HEAD (e.g. 405) is **not** fatal.
2. `GET` with `Range: bytes=0-0` — the probe body is dropped unread.
   - `206 Partial Content` + `Content-Range: bytes 0-0/<total>` proves
     Range support and gives the total size.
   - `200 OK` proves the server ignores Range for this resource.

Redirects are followed (reqwest, max 10). TLS is rustls (no OpenSSL
dependency). A probe that returns a non-success status (e.g. 404) is a
hard error before any file is created.

## 3. Segment model

- If Range is supported and the size is known, the file is split into
  `min(connections, size)` contiguous, non-overlapping segments.
  Segment `i` covers bytes `[start, end]` inclusive; the remainder of
  `total mod connections` is distributed one byte at a time over the
  first segments, so segments differ by at most 1 byte.
- If Range is **not** supported, or the size is unknown, the engine uses
  exactly **one** segment (single-connection fallback), regardless of
  `--connections`. The user is told this on stderr.
- Each segment is downloaded by its own async task with its own HTTP
  request (`Range: bytes=<start+done>-<end>`) and its own file handle
  seeking to `start + done`. Segments never overlap, so no inter-task
  locking on file offsets is needed.
- **More connections do not always mean faster.** On a fast local
  server, 1 and 4 connections measured the same (see TEST_NOTES.md);
  on a slow or per-connection-throttled server they can help, and on a
  congested server they can hurt. `--connections` is a user control,
  not a speed promise. Valid range: 1–32 (clamped).

## 4. Checkpoint format (engine format, version 1)

File: `<DEST>.checkpoint.json` by default, or `--checkpoint PATH`.
Written **atomically**: serialise to `<path>.tmp`, then rename over the
checkpoint, so a crash can never leave a half-written checkpoint.

```json
{
  "version": 1,
  "url": "https://example.com/file.bin",
  "destination": "/tmp/file.bin",
  "part_path": "/tmp/file.bin.part",
  "total_size": 5242880,
  "etag": "\"abc123\"",
  "last_modified": "Wed, 01 Jan 2025 00:00:00 GMT",
  "accept_ranges": true,
  "connections": 4,
  "segments": [
    { "index": 0, "start": 0, "end": 1310719, "done": 1310720 }
  ]
}
```

- `end` is **inclusive**. `done` counts bytes already written for that
  segment; the next byte to fetch is `start + done`. A segment is
  complete when `done == end - start + 1`.
- `total_size: null` + a single segment with `end: null` represents an
  unknown-length stream; `done` is then just the byte count so far.
- **Flush cadence:** at most every 500 ms during download, plus always
  on pause, failure, and completion. Consequence: after a hard kill
  (SIGKILL, power loss) up to ~500 ms of progress may be re-downloaded
  on resume — the download is still correct, just slightly redundant.
  Ctrl-C pause always flushes first, so a clean pause loses nothing.
- **Difference from the QA harness format:** the harness
  (`tests/downloader.py`) checkpoint uses
  `{url, dest, total_size, downloaded, parts: [{start, end, done: bool}],
  expected_sha256}`. The engine format is not compatible with it and is
  not meant to be: the engine tracks per-segment byte counts (not
  booleans) and server-change metadata (ETag/size). Do not feed one
  format to the other implementation.

## 5. Pause / resume

- **Pause:** Ctrl-C (SIGINT, and SIGTERM via the same handler). Workers
  finish their current 64 KiB chunk, the checkpoint is flushed, and the
  process exits **130** with the `.part` file left in place.
- **Resume:** `dm <URL> <DEST> --resume`. The engine re-probes and
  refuses to resume when:
  - the checkpoint URL differs from the requested URL;
  - the checkpoint belongs to a different destination (different
    `.part` path);
  - the current content-length differs from the checkpoint size;
  - the current ETag differs from the checkpoint ETag (when both are
    present);
  - the download is incomplete and the server does not support Range
    (a 200 full body written at a non-zero offset would corrupt the
    file — this also covers no-Range servers, not just unknown-length
    streams).
  In all refusal cases the message says to use `--restart`.
- `--restart` deletes the `.part` file and checkpoint and starts fresh.
  Without `--resume`/`--restart`, an existing `.part`/checkpoint is
  overwritten with a warning.
- A checkpoint that is already complete skips downloading and goes
  straight to verification + rename.

## 6. Retry

Per segment, up to `--max-retries` retries (default 5) after failures
(network errors, unexpected status, stream ending early). Backoff is
exponential: 0.5 s, 1 s, 2 s, 4 s, 8 s, capped at 8 s. After retries are
exhausted the whole download fails, the checkpoint is preserved, and
the exit code is 1. A retry re-requests only the missing byte range
(`start + done`), never the whole segment.

## 7. Bandwidth throttle

`--throttle RATE` (bytes/sec; suffixes `k`/`m`/`g` = 1024-based; `0` =
unlimited) is enforced by a **single shared token bucket** across all
segments, so the cap is aggregate, not per-connection (a per-connection
cap would silently multiply the limit by the connection count). The
bucket refills continuously from wall-clock time and holds at most one
second of burst. Workers draw budget per 64 KiB chunk before writing.

## 8. Atomic completion and integrity

1. All bytes go to `<DEST>.part`, pre-sized (sparse) to the known total
   so segment seeks are always valid. The destination file is never
   written directly.
2. On completion the engine checks downloaded bytes == total size.
3. SHA-256 of the `.part` file is **always** computed (streamed, 64 KiB
   at a time) and printed. If `--sha256 HEX` was given and differs, the
   download fails, the destination is **not** created, and the `.part`
   file is kept for inspection (exit 1).
4. Only then is `<DEST>.part` renamed to `<DEST>` (atomic on the same
   filesystem) and the checkpoint deleted.

## 9. Bounded memory

Workers stream responses and hold at most one 64 KiB chunk each, plus
one 64 KiB hashing buffer. Memory use is therefore
`O(connections × 64 KiB)`, independent of file size. The whole file is
never loaded into RAM. (Disk I/O per chunk uses synchronous file writes
from async tasks; acceptable for Phase 1 local-disk targets.)

## 10. Errors and exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (downloaded, verified, renamed) |
| 1 | Error, hash mismatch, resume refused, or probe failure |
| 2 | Usage error (bad/missing arguments) |
| 130 | Paused via Ctrl-C; checkpoint saved, resumable |

Progress (bytes, %, segments, KiB/s, ETA) goes to **stderr** every
500 ms; the final `done:` summary goes to **stdout**, so stdout stays
machine-friendly.

## 11. Known limits (Phase 1)

- ETag change detection is implemented but **not live-tested**: the
  local test server sends no ETag (see TEST_NOTES.md, "not-run").
- HTTPS is implemented via rustls but **not live-tested** against a
  local TLS fixture (tests use plain HTTP on loopback); the TLS code
  path is the same reqwest client, but a TLS handshake was not
  exercised in this phase.
- No dedicated flaky-server retry test exists yet: the retry loop with
  its backoff schedule was observed in logs during a pre-fix failure
  run, but a systematic flaky-server test is **not-run**.
- Checkpoint flush granularity is 500 ms (see §4): a hard kill may
  re-download up to ~500 ms of progress.
- The `.part` file is pre-sized sparse; on filesystems without sparse
  support this allocates the full size up front.
- No checksum is verified *during* download; corruption is caught only
  by the final size + SHA-256 checks.
- Concurrent runs against the same destination are not locked; do not
  run two `dm` processes on the same `<DEST>` simultaneously.
