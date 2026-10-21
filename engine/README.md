# Download Manager — Engine (Phase 1)

**What actually shipped: full Rust.** Not a Python reference + Rust
skeleton. See "Why Rust shipped" below.

## What this is

`dm`: a parallel, resumable HTTP/HTTPS download engine. Single binary,
no runtime dependencies beyond system libc.

- HTTP/HTTPS with redirect following (max 10) and rustls TLS
- Range detection via HEAD + `Range: bytes=0-0` probe
- Parallel segmented download (`--connections`, 1–32, clamped)
- Pause/resume via JSON checkpoint (Ctrl-C pauses, exit 130;
  `--resume` continues; `--restart` starts fresh)
- Retry with exponential backoff (0.5 s → 8 s cap, default 5 retries)
- Aggregate bandwidth throttle (`--throttle`, shared token bucket)
- Atomic completion: download to `<DEST>.part`, rename only on success
- SHA-256 verification (`--sha256` gates the rename; the hash is
  always computed and printed)
- ETag / content-length change detection on resume (refuses to resume
  a changed file instead of corrupting it)
- Single-connection fallback for servers that ignore Range
- Bounded memory: 64 KiB streaming chunks, never the whole file in RAM

Full design, checkpoint format, segment model and limits: [SPEC.md](SPEC.md).
Real test outputs: [TEST_NOTES.md](TEST_NOTES.md).

## Why Rust shipped (and no Python reference)

The task allowed a Python reference + Rust skeleton **only if** Rust
was impractical. It turned out to be practical:

1. At task start, `rustc`/`cargo` were **absent** on this Linux VM
   (Python 3.12 and Node 24 were present).
2. A timeboxed rustup install was attempted. The first run was cut off
   by the 120 s timeout mid-download, leaving a broken toolchain
   (`rustc` missing, "installation was interrupted"). A second run
   with `rustup toolchain install stable --force` recovered it in
   ~49 s. Final toolchain: **rustc 1.99.1, cargo 1.99.1**.
3. A crate-fetch smoke test (`reqwest 0.12` + `tokio 1`) succeeded, so
   a real async HTTP engine was buildable — no skeleton needed.

Consequence: the Python reference implementation was deliberately **not**
written, to avoid maintaining two implementations of the same spec.
The sibling QA harness in `tests/` (`downloader.py`) is a test client
only, not an engine, and its checkpoint format differs from the engine
format (documented in SPEC.md §4).

## Build

```sh
cd ~/workspace/download-manager/engine
export PATH="$HOME/.cargo/bin:$PATH"   # only if rustup is not on PATH
cargo build --release
# binary: target/release/dm
```

A prebuilt Linux binary is kept at `target/release/dm` (5.5 MB; the
247 MB cargo cache was pruned). **No Windows `.exe` was built** — this
VM has no Windows access, and none is claimed.

Dependencies (pinned in `Cargo.lock`): tokio 1, reqwest 0.12
(rustls-tls), serde/serde_json 1, sha2 0.10, ctrlc 3, futures-util 0.3.

## Usage

```sh
dm <URL> <DEST> [options]

# Examples:
dm https://example.com/big.iso ./big.iso --connections 4
dm https://example.com/big.iso ./big.iso --connections 8 --throttle 2m --sha256 <hex>
dm https://example.com/big.iso ./big.iso --resume        # after Ctrl-C
dm https://example.com/big.iso ./big.iso --restart       # discard partial, start over
```

| Option | Meaning |
|--------|---------|
| `--connections N`, `-c N` | Parallel connections, 1–32 (default 4); forced to 1 without Range support |
| `--throttle RATE`, `-t RATE` | Aggregate bytes/sec cap (`k`/`m`/`g` suffixes, `0` = unlimited, default 0) |
| `--resume`, `-r` | Resume from `<DEST>.part` + `<DEST>.checkpoint.json` |
| `--restart` | Discard `.part`/checkpoint and start fresh |
| `--sha256 HEX` | Expected SHA-256; mismatch blocks the rename |
| `--checkpoint PATH` | Checkpoint path (default `<DEST>.checkpoint.json`) |
| `--max-retries N` | Retries per segment (default 5) |
| `--help`, `-h` | Show help |

Exit codes: `0` success, `1` error/hash mismatch/resume refused,
`2` usage error, `130` paused via Ctrl-C (checkpoint saved).

## Files

| Path | What it is |
|------|-----------|
| `Cargo.toml`, `Cargo.lock` | Crate manifest + pinned dependencies |
| `src/main.rs` | CLI, probe, segment workers, retry, progress, SHA-256, orchestration |
| `src/checkpoint.rs` | Checkpoint JSON format, segment splitting |
| `src/throttle.rs` | Shared token-bucket throttle |
| `SPEC.md` | Design spec (this document's companion) |
| `TEST_NOTES.md` | Real test results (sizes, hashes, timings, pass/fail) |
| `tests/test_engine.py` | Engine integration tests (drive the real `dm` binary) |
| `tests/test_server.py`, `tests/downloader.py`, `tests/test_downloads.py`, `tests/run_tests.py` | Pre-existing sibling QA harness (not modified by the engine work; its README still says "engine-integration tests are PENDING" — that note is now stale, superseded by `test_engine.py`) |
| `target/release/dm` | Prebuilt Linux binary |

## Run the tests

```sh
cd ~/workspace/download-manager/engine/tests
python3 -m unittest -v test_engine     # engine integration: 10 tests
python3 -m unittest -v test_downloads  # sibling harness: 9 tests
cd .. && cargo test --release          # Rust unit tests: 2 tests
```

All three suites pass on this VM (see TEST_NOTES.md for the numbers).
Tests use only loopback HTTP (`127.0.0.1`); no external network, no
DRM circumvention, no production system touched. Nothing outside
`~/workspace/download-manager/engine/` was modified by this work
(except the rustup toolchain install in `~/.rustup` / `~/.cargo`).

## Notes for the next phase

- The checkpoint format is versioned (`version: 1`) so a future queue
  format can extend it without breaking old checkpoints.
- More connections are **not** always faster — see SPEC.md §3 and the
  local numbers in TEST_NOTES.md before tuning defaults.
- Before any internet-facing claim: live-test HTTPS against a real TLS
  server and ETag change detection against an ETag-sending server
  (both are currently implemented-but-not-live-tested, §11 of SPEC.md).
