#!/usr/bin/env python3
"""Repeatable local benchmark for the download-manager Phase 1 project.

What this script does (and does NOT do):
  * Starts a local HTTP server on 127.0.0.1 serving ONE deterministic test file.
  * Downloads that file with:
      (a) curl, single connection  -- the baseline, always run;
      (b) a small stdlib segmented downloader (Range requests, N parallel
          connections) -- a REFERENCE implementation written for this
          benchmark only. It is NOT the Phase 1 engine prototype.
      (c) the Phase 1 engine prototype, ONLY if one is present in
          ../engine/ AND an explicit --engine-cmd template is supplied.
          Without that, the engine comparison is reported as NOT RUN.
          This script never guesses an engine CLI and never fakes a row.
  * Reports, per trial: wall time, bytes, SHA-256, throughput, and the
    server-side delta of accepted TCP connections and HTTP requests.

What this script does NOT measure:
  * Anything against IDM (not available on this Linux VM, never claimed).
  * Real internet performance. Loopback (127.0.0.1) has ~no latency, ~no
    packet loss and huge bandwidth; it is a correctness + plumbing check,
    not a predictor of WAN download speed. See docs/benchmarks.md.
  * Resume / retry / throttling / multi-mirror behaviour (not exercised).

Usage:
    python3 benchmarks/bench.py [--size-mib 64] [--trials 3]
                                [--segments 8] [--work-dir DIR] [--keep]
                                [--engine-cmd "python3 engine/x.py {url} -o {out}"]

Exit code is 0 only if every run method produced a byte-identical file
(SHA-256 equal to the source). The engine row, when absent, is NOT a
failure: it is reported as NOT RUN.
"""

import argparse
import hashlib
import json
import os
import platform
import random
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHUNK = 1024 * 1024  # 1 MiB


# --------------------------------------------------------------------------
# Deterministic test file
# --------------------------------------------------------------------------
def generate_test_file(path, size_bytes, seed=20261021):
    """Write a deterministic, incompressible-ish file.

    Seeded PRNG output (not a repeating pattern) so no HTTP layer, proxy,
    or filesystem trick can compress or shortcut it. Same seed => same
    file => same SHA-256 on every run, on any machine.
    """
    rng = random.Random(seed)
    with open(path, "wb") as fh:
        remaining = size_bytes
        while remaining > 0:
            n = min(CHUNK, remaining)
            fh.write(rng.randbytes(n))
            remaining -= n


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            data = fh.read(CHUNK)
            if not data:
                break
            h.update(data)
    return h.hexdigest()


# --------------------------------------------------------------------------
# Range-aware local HTTP server with connection/request counters
# --------------------------------------------------------------------------
class CountingServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.lock = threading.Lock()
        self.accepts = 0      # accepted TCP connections (server side)
        self.requests = 0     # HTTP requests handled (server side)

    def get_request(self):
        sock, addr = super().get_request()
        with self.lock:
            self.accepts += 1
        return sock, addr

    def snapshot(self):
        with self.lock:
            return {"accepts": self.accepts, "requests": self.requests}


def make_handler(test_file_path, file_size):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "bench/1.0"

        def log_message(self, *args):  # keep stdout clean
            pass

        def _send_range(self, start, end):
            length = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range",
                             f"bytes {start}-{end}/{file_size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
            with open(test_file_path, "rb") as fh:
                fh.seek(start)
                remaining = length
                while remaining > 0:
                    data = fh.read(min(CHUNK, remaining))
                    if not data:
                        break
                    self.wfile.write(data)
                    remaining -= len(data)

        def do_GET(self):
            server = self.server
            with server.lock:
                server.requests += 1
            if self.path != "/test.bin":
                body = b"not found"
                self.send_response(404)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            range_hdr = self.headers.get("Range")
            m = re.match(r"bytes=(\d*)-(\d*)$", range_hdr or "")
            if m and (m.group(1) or m.group(2)):
                start = int(m.group(1)) if m.group(1) else 0
                end = int(m.group(2)) if m.group(2) else file_size - 1
                if start >= file_size or end < start:
                    self.send_response(416)
                    self.send_header("Content-Range",
                                     f"bytes */{file_size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self._send_range(start, min(end, file_size - 1))
                return
            # Full download.
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(file_size))
            self.end_headers()
            with open(test_file_path, "rb") as fh:
                shutil.copyfileobj(fh, self.wfile, length=CHUNK)

        def do_HEAD(self):
            with self.server.lock:
                self.server.requests += 1
            if self.path != "/test.bin":
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(file_size))
            self.end_headers()

    return Handler


# --------------------------------------------------------------------------
# Download methods
# --------------------------------------------------------------------------
def run_curl_single(url, out_path):
    """Baseline: one curl invocation, one connection, no ranges."""
    proc = subprocess.run(
        ["curl", "-sS", "--fail", "-o", out_path, url],
        capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"curl failed rc={proc.returncode}: "
                           f"{proc.stderr.strip()[:500]}")


def _fetch_range(url, start, end, out_path, lock):
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        if resp.status != 206:
            raise RuntimeError(f"range request got HTTP {resp.status}, "
                               f"expected 206")
        data = resp.read()
    if len(data) != end - start + 1:
        raise RuntimeError(f"range {start}-{end}: got {len(data)} bytes")
    with lock:
        with open(out_path, "r+b") as fh:
            fh.seek(start)
            fh.write(data)


def run_segmented_reference(url, out_path, file_size, segments):
    """Reference segmented downloader (stdlib only).

    NOT the Phase 1 engine. Each segment opens its own TCP connection
    (urllib, no connection reuse across segments), so by construction
    server-side accepts == segments for a clean run.
    """
    with open(out_path, "wb") as fh:
        fh.truncate(file_size)
    lock = threading.Lock()
    bounds = []
    base, rem = divmod(file_size, segments)
    start = 0
    for i in range(segments):
        end = start + base - 1 + (1 if i < rem else 0)
        bounds.append((start, end))
        start = end + 1
    with ThreadPoolExecutor(max_workers=segments) as pool:
        list(pool.map(lambda b: _fetch_range(url, b[0], b[1], out_path, lock),
                      bounds))


def detect_engine(engine_dir):
    """Return a list of files found in engine_dir, or [] if it is empty.

    Presence alone does NOT mean 'runnable': this script refuses to guess
    a CLI. A runnable engine row requires --engine-cmd.
    """
    if not os.path.isdir(engine_dir):
        return None  # directory itself missing
    found = []
    for root, _dirs, files in os.walk(engine_dir):
        for name in sorted(files):
            found.append(os.path.relpath(os.path.join(root, name), engine_dir))
    return found


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def measure(fn, url, out_path, server, file_size, source_sha):
    before = server.snapshot()
    t0 = time.monotonic()
    fn()
    elapsed = time.monotonic() - t0
    after = server.snapshot()
    got_size = os.path.getsize(out_path)
    got_sha = sha256_of(out_path)
    return {
        "elapsed_s": round(elapsed, 4),
        "bytes": got_size,
        "sha256": got_sha,
        "sha_match": got_sha == source_sha,
        "size_match": got_size == file_size,
        "throughput_mib_s": round((got_size / 1048576) / elapsed, 2)
        if elapsed > 0 else None,
        "server_accepts_delta": after["accepts"] - before["accepts"],
        "server_requests_delta": after["requests"] - before["requests"],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--size-mib", type=int, default=64)
    ap.add_argument("--trials", type=int, default=3)
    ap.add_argument("--segments", type=int, default=8)
    ap.add_argument("--work-dir", default=None,
                    help="default: <script-dir>/.bench-work")
    ap.add_argument("--keep", action="store_true",
                    help="keep downloaded files instead of deleting them")
    ap.add_argument("--engine-cmd", default=None,
                    help="template with {url} and {out}, e.g. "
                         "'python3 engine/down.py {url} -o {out}'")
    args = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    engine_dir = os.path.join(project_dir, "engine")
    work_dir = args.work_dir or os.path.join(script_dir, ".bench-work")
    os.makedirs(work_dir, exist_ok=True)

    file_size = args.size_mib * 1024 * 1024
    test_file = os.path.join(work_dir, "test.bin")
    if not os.path.exists(test_file) or os.path.getsize(test_file) != file_size:
        print(f"[setup] generating deterministic {args.size_mib} MiB "
              f"test file ...")
        generate_test_file(test_file, file_size)
    source_sha = sha256_of(test_file)
    print(f"[setup] source: {file_size} bytes, sha256={source_sha}")

    engine_files = detect_engine(engine_dir)
    if engine_files is None:
        engine_status = "NOT RUN -- engine/ directory missing"
    elif not engine_files:
        engine_status = ("NOT RUN -- engine/ exists but is empty; "
                         "no Phase 1 prototype present at run time")
    elif not args.engine_cmd:
        engine_status = ("NOT RUN -- engine/ contains files "
                         f"({', '.join(engine_files)}) but no "
                         "--engine-cmd was supplied, so no CLI was guessed")
    else:
        engine_status = "RUN (explicit --engine-cmd supplied)"
    print(f"[setup] engine: {engine_status}")

    handler = make_handler(test_file, file_size)
    server = CountingServer(("127.0.0.1", 0), handler)
    host, port = server.server_address
    url = f"http://{host}:{port}/test.bin"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"[setup] local server: {url} (loopback only, Range-aware)")

    try:
        curl_version = subprocess.run(
            ["curl", "--version"], capture_output=True, text=True
        ).stdout.splitlines()[0]
    except Exception as exc:  # pragma: no cover
        curl_version = f"unavailable ({exc})"

    results = {
        "environment": {
            "os": f"{platform.system()} {platform.release()} "
                  f"({platform.machine()})",
            "uname": platform.uname()._asdict(),
            "cpu_count_logical": os.cpu_count(),
            "python": platform.python_version(),
            "curl": curl_version,
            "node": shutil.which("node") and subprocess.run(
                ["node", "--version"], capture_output=True,
                text=True).stdout.strip(),
        },
        "test_file": {"bytes": file_size, "mib": args.size_mib,
                      "sha256": source_sha, "url": url},
        "engine_status": engine_status,
        "engine_files_found": engine_files,
        "methods": {},
    }

    all_ok = True

    # --- (a) curl single-connection baseline ------------------------------
    rows = []
    for i in range(1, args.trials + 1):
        out = os.path.join(work_dir, f"curl-single-t{i}.bin")
        row = measure(lambda o=out: run_curl_single(url, o), url, out,
                      server, file_size, source_sha)
        row["trial"] = i
        rows.append(row)
        all_ok &= row["sha_match"] and row["size_match"]
        if not args.keep:
            os.remove(out)
    results["methods"]["curl_single"] = rows

    # --- (b) segmented reference (NOT the engine) -------------------------
    rows = []
    for i in range(1, args.trials + 1):
        out = os.path.join(work_dir, f"segmented-ref-t{i}.bin")
        row = measure(
            lambda o=out: run_segmented_reference(url, o, file_size,
                                                  args.segments),
            url, out, server, file_size, source_sha)
        row["trial"] = i
        row["segments"] = args.segments
        rows.append(row)
        all_ok &= row["sha_match"] and row["size_match"]
        if not args.keep:
            os.remove(out)
    results["methods"]["segmented_reference_NOT_engine"] = rows

    # --- (c) Phase 1 engine, only with an explicit command ----------------
    if args.engine_cmd:
        rows = []
        for i in range(1, args.trials + 1):
            out = os.path.join(work_dir, f"engine-t{i}.bin")
            cmd = args.engine_cmd.format(url=url, out=out)
            def _run(c=cmd):
                proc = subprocess.run(c, shell=True, capture_output=True,
                                      text=True)
                if proc.returncode != 0:
                    raise RuntimeError(
                        f"engine cmd failed rc={proc.returncode}: "
                        f"{proc.stderr.strip()[:500]}")
            row = measure(_run, url, out, server, file_size, source_sha)
            row["trial"] = i
            rows.append(row)
            all_ok &= row["sha_match"] and row["size_match"]
            if not args.keep:
                os.remove(out)
        results["methods"]["engine"] = rows
    else:
        results["methods"]["engine"] = "NOT RUN"

    server.shutdown()
    server.server_close()

    # --- report ------------------------------------------------------------
    print()
    print("== RESULTS (loopback 127.0.0.1 -- NOT internet speeds) ==")
    for method, rows in results["methods"].items():
        if isinstance(rows, str):
            print(f"  {method}: {rows}")
            continue
        for r in rows:
            print(f"  {method} trial {r['trial']}: {r['elapsed_s']}s, "
                  f"{r['bytes']} bytes, {r['throughput_mib_s']} MiB/s, "
                  f"sha_match={r['sha_match']}, "
                  f"server_accepts_delta={r['server_accepts_delta']}, "
                  f"server_requests_delta={r['server_requests_delta']}")
    out_json = os.path.join(work_dir, "results.json")
    with open(out_json, "w") as fh:
        json.dump(results, fh, indent=2)
    print(f"\n[done] full JSON: {out_json}")
    print(f"[done] overall byte-identical: {all_ok}")
    if not all_ok:
        print("[done] WARNING: at least one download did not match the "
              "source hash/size -- see rows above.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
