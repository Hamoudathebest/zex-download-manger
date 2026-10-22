# Checkpoint v2 — the one checkpoint format

**Status:** Canonical, implemented in Phase 2. This document settles
open decision D-06 (checkpoint suffix/layout) for the checkpoint
*format* (the file suffix remains `<DEST>.checkpoint.json`).

**Rule:** every component that reads or writes a download checkpoint
uses this format and no other. The Rust engine (`engine/src/checkpoint.rs`)
writes v2, the Python QA harness (`engine/tests/downloader.py`) writes
v2 and refuses non-v2, and the engine-integration tests
(`engine/tests/test_engine.py`) assert `format_version == 2`.

## Why v2 exists

Phase 1 shipped three divergent v1 formats for the same concept:

| Source | Format | Divergences |
|---|---|---|
| Architecture §9.2 | `formatVersion: 1`, `jobId`, `totalBytes`, `supportsRanges`, segments `{index, start, end, downloaded, status, attempts}`, plus `bytesDownloaded`, `checksum`, `media`, `error` | The most complete shape, but no code implemented it verbatim. |
| Rust engine (v1) | `version: 1`, `url`, `destination`, `part_path`, `total_size`, `accept_ranges`, `connections`, segments `{index, start, end, done}` | No job id, status, category, checksum, or media fields; `done` instead of `downloaded`. |
| QA harness (v1) | `version: 1`, `url`, `dest`, `total_size`, `downloaded`, `parts: [{start, end, done: bool}]`, `expected_sha256` | Segment progress was a boolean, not a byte count; no per-segment offsets in bytes, no ETag, no status. |

Feeding one v1 file to another implementation was not possible, and
the Phase 1 docs said so honestly. V2 is the architecture shape,
adopted as code, with the Rust engine's segment-splitting and
atomic-write discipline kept.

## Format (JSON, UTF-8, pretty-printed)

```json
{
  "format_version": 2,
  "job_id": "dm-1234567890",
  "url": "https://example.com/file.bin",
  "original_url": "https://example.com/redirect",
  "destination": "/tmp/file.bin",
  "part_path": "/tmp/file.bin.part",
  "total_bytes": 10485760,
  "supports_ranges": true,
  "etag": "\"abc123\"",
  "last_modified": "Wed, 01 Jan 2025 00:00:00 GMT",
  "content_type": null,
  "category": "general",
  "priority": 0,
  "max_connections": 4,
  "status": "downloading",
  "segments": [
    {"index": 0, "start": 0, "end": 2621439,
     "downloaded": 2621440, "status": "done", "attempts": 1}
  ],
  "bytes_downloaded": 2621440,
  "checksum": {"algorithm": "sha256", "expected": null},
  "media": null,
  "error": null
}
```

## Field rules

- `format_version` is mandatory and must be `2`. A reader that sees
  any other value must refuse to resume that job (typed error,
  e.g. `CHECKPOINT_VERSION_UNSUPPORTED`) rather than guessing.
- `url` is the final URL after redirects; `original_url` is kept for
  display/diagnosis only. Resume re-probes `url`.
- `destination` is the final file path; `part_path` is the
  in-progress file (`<destination>.part`). The final file is created
  only by atomic rename after verification.
- `total_bytes` is `null` when unknown. Then there is exactly one
  segment with `end: null`, `downloaded` = bytes so far, and resume
  uses `Range: bytes=<downloaded>-` if the server accepts it.
- Segment `end` is **inclusive**. `downloaded` counts bytes
  **confirmed written to disk** (after flush), not bytes received
  into a memory buffer. The next byte to fetch is
  `start + downloaded`. A segment is complete when
  `downloaded == end - start + 1`.
- `bytes_downloaded` is the sum of segment `downloaded` values. It
  is refreshed on every save; readers must not trust a stale value
  over the segment sum — the segment sum is authoritative.
- `status` is one of: `queued`, `probing`, `downloading`, `paused`,
  `verifying`, `completed`, `failed`, `cancelled`. The engine sets
  `paused` on Ctrl-C pause and `failed` on a terminal failure. On
  successful completion the checkpoint file is removed, so a
  `completed` checkpoint is normally never read back.
- `segments[].status` is one of: `pending`, `active`, `done`,
  `failed`. `attempts` counts download attempts for that segment
  (retries included).
- `checksum.expected` is set only when the user or server supplied a
  digest; otherwise `null`. `checksum.algorithm` is e.g. `sha256`.
- `media` is `null` for ordinary downloads, or the media job object
  (architecture §6.5) for playlist jobs. Encrypted media never
  creates a job, so a v2 checkpoint never describes a DRM job.
- No credentials anywhere in this file. If the original URL contained
  credentials, they are stripped before writing. File permissions are
  `0600` by convention for checkpoints and `.part` files (see
  architecture §9.3).

## Write discipline (unchanged from v1, now enforced in code)

1. Write to `<checkpoint>.tmp`, fsync the tmp file, rename over the
   checkpoint, in the same directory. Readers never see a half-written
   checkpoint.
2. Save at most every 500 ms during download, and always on pause,
   failure, and completion. After a hard kill, up to ~500 ms of
   progress may be re-downloaded; it is never assumed present.
3. On resume, the engine re-probes and refuses when the URL differs,
   the destination differs, the size changed, the ETag changed (when
   both are present), or the server does not support Range and the
   download is incomplete. Refusal messages say to use `--restart`.

## Mapping from the old v1 formats

| v2 field | Architecture v1 | Rust v1 | QA harness v1 |
|---|---|---|---|
| `format_version` | `formatVersion` | `version` | `version` |
| `job_id` | `jobId` | — (generated on import as `imported-<destination>`) | — (harness uses `harness-job-1` in tests) |
| `url` | `url` | `url` | `url` |
| `original_url` | `originalUrl` | — (= `url` on import) | — (= `url` on import) |
| `destination` | `finalName` + `downloadDir` (combined) | `destination` | `dest` |
| `part_path` | `partPath` | `part_path` | `destination + ".part"` (derived) |
| `total_bytes` | `totalBytes` | `total_size` | `total_size` |
| `supports_ranges` | `supportsRanges` | `accept_ranges` | assumed `true` in harness (Range server) |
| `etag` / `last_modified` | same | same | — (`null` on import) |
| `max_connections` | `maxConnections` | `connections` | segment count |
| `segments[].downloaded` | `downloaded` | `done` | `parts[].done` (bool) — **not** convertible to a byte count; a harness v1 checkpoint must not be imported as an engine resume state, only rewritten as a fresh v2 document |
| `segments[].status` / `attempts` | `status` / `attempts` | — (defaults `pending`/`active`, `0`) | — |
| `bytes_downloaded` | `bytesDownloaded` | sum of `done` | `downloaded` |
| `checksum.expected` | `checksum.expected` | — (CLI `--sha256` is not stored in v1) | `expected_sha256` |
| `status` / `category` / `priority` / `media` / `error` | present | — (defaults `downloading`/`general`/`0`/`null`/`null`) | — |

## Migration (one-way, import only)

The Rust engine's `Checkpoint::load` tries v2 first. If that fails
and the file parses as Rust v1 (`version: 1` with `total_size` /
`accept_ranges` / `connections` / segments with `done`), it converts
it to v2 in memory (job id `imported-<destination>`, status
`paused`) and the next save writes v2. This is an import shim, not
a second live format: no code writes v1, and no test writes v1.

QA harness v1 files are **not** imported as engine checkpoints,
because their boolean segment progress cannot be converted to byte
offsets without guessing. Harness tests were rewritten to write v2
directly (see `engine/tests/downloader.py`).

## What v2 does NOT do

- V2 is a per-download checkpoint, not a multi-item queue format.
  Queue persistence (a queue surviving an engine restart, with
  ordering and priorities for many jobs) is still a separate Phase 2
  task and is not claimed by this document.
- V2 does not change the `.part` file layout, the segment-splitting
  rule, or the resume-refusal rules — only the checkpoint JSON.
